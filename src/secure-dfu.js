"use strict"
require("babel-polyfill");

import EventEmitter from "events"

const SERVICE_UUID = "fe59"
const CONTROL_UUID = "8ec90001-f315-4f60-9fb8-838830daea50"
const PACKET_UUID = "8ec90002-f315-4f60-9fb8-838830daea50"
const BUTTON_UUID = "8ec90003-f315-4f60-9fb8-838830daea50"

const LITTLE_ENDIAN = true
const PACKET_SIZE = 20

const OPERATIONS = {
  BUTTON_COMMAND: [0x01],
  CREATE_COMMAND: [0x01, 0x01],
  CREATE_DATA: [0x01, 0x02],
  RECEIPT_NOTIFICATIONS: [0x02],
  CALCULATE_CHECKSUM: [0x03],
  EXECUTE: [0x04],
  SELECT_COMMAND: [0x06, 0x01],
  SELECT_DATA: [0x06, 0x02],
  RESPONSE: [0x60, 0x20],
}

const RESPONSE = {
  0x00: "Invalid code", // Invalid opcode.
  0x01: "Success", // Operation successful.
  0x02: "Opcode not supported", // Opcode not supported.
  0x03: "Invalid parameter", // Missing or invalid parameter value.
  0x04: "Insufficient resources", // Not enough memory for the data object.
  0x05: "Invalid object", // Data object does not match the firmware and hardware requirements, the signature is wrong, or parsing the command failed.
  0x07: "Unsupported type", // Not a valid object type for a Create request.
  0x08: "Operation not permitted", // The state of the DFU process does not allow this operation.
  0x0a: "Operation failed", // Operation failed.
  0x0b: "Extended error", // Extended error.
}

const EXTENDED_ERROR = {
  0x00: "No error", // No extended error code has been set. This error indicates an implementation problem.
  0x01: "Invalid error code", // Invalid error code. This error code should never be used outside of development.
  0x02: "Wrong command format", // The format of the command was incorrect.
  0x03: "Unknown command", // The command was successfully parsed, but it is not supported or unknown.
  0x04: "Init command invalid", // The init command is invalid. The init packet either has an invalid update type or it is missing required fields for the update type.
  0x05: "Firmware version failure", // The firmware version is too low. For an application, the version must be greater than the current application. For a bootloader, it must be greater than or equal to the current version.
  0x06: "Hardware version failure", // The hardware version of the device does not match the required hardware version for the update.
  0x07: "Softdevice version failure", // The array of supported SoftDevices for the update does not contain the FWID of the current SoftDevice.
  0x08: "Signature missing", // The init packet does not contain a signature.
  0x09: "Wrong hash type", // The hash type that is specified by the init packet is not supported by the DFU bootloader.
  0x0a: "Hash failed", // The hash of the firmware image cannot be calculated.
  0x0b: "Wrong signature type", // The type of the signature is unknown or not supported by the DFU bootloader.
  0x0c: "Verification failed", // The hash of the received firmware image does not match the hash in the init packet.
  0x0d: "Insufficient space", // The available space on the device is insufficient to hold the firmware.
}

export const STATES = {
  CONNECTING: 0,
  STARTING: 1,
  UPLOADING: 3,
  DISCONNECTING: 5,
  COMPLETED: 6,
  ABORTED: 7,
}

export class SecureDFU extends EventEmitter {
  static SERVICE_UUID = SERVICE_UUID

  constructor(crc) {
    super()
    this.crc32 = crc
    this.events = {}
    this.notifyFns = {}
    this.controlChar = null
    this.packetChar = null
    this.isAborted = false
  }

  log(message) {
    this.emit("log", { message })
  }

  error(err) {
    this.emit("error", err)
  }

  state(state) {
    this.emit("stateChanged", { state })
  }

  progress(bytes) {
    this.emit("progress", {
      object: "unknown",
      totalBytes: 0,
      currentBytes: bytes,
    })
  }

  async update(device, init, firmware) {
    this.isAborted = false

    if (!device) throw new Error("Device not specified")
    if (!init) throw new Error("Init not specified")
    if (!firmware) throw new Error("Firmware not specified")

    this.state(STATES.CONNECTING)
    const disconnectWatcher = new Promise((resolve, reject) => {
      device.once("disconnect", () => {
        this.controlChar = null
        this.packetChar = null
        reject('disconnected')
      })
    })

    await Promise.race([this.doUpdate(device, init, firmware), disconnectWatcher])
    return this.disconnect(device)
  }

  async doUpdate(device, init, firmware) {
    await this.connect(device)
    this.log("transferring init")
    this.state(STATES.STARTING)
    await this.transferInit(init)
    this.log("transferring firmware")
    this.state(STATES.UPLOADING)
    await this.transferFirmware(firmware)
    this.state(STATES.COMPLETED)
  }

  abort() {
    this.isAborted = true
  }

  async connect(device) {
    const characteristics = await this.gattConnect(device)
    this.log(`found ${characteristics.length} characteristic(s)`)

    this.packetChar = characteristics.find(characteristic => {
      return getCanonicalUUID(characteristic.uuid) === PACKET_UUID
    })
    if (!this.packetChar) throw new Error("Unable to find packet characteristic")
    this.log("found packet characteristic")

    this.controlChar = characteristics.find(characteristic => {
      return getCanonicalUUID(characteristic.uuid) === CONTROL_UUID
    })
    if (!this.controlChar) throw new Error("Unable to find control characteristic")
    this.log("found control characteristic")

    if (!this.controlChar.properties.includes("notify") && !this.controlChar.properties.includes("indicate")) {
      throw new Error("Control characteristic does not allow notifications")
    }
    this.controlChar.on("data", this.handleNotification.bind(this))
    return new Promise((resolve, reject) => {
      this.controlChar.notify(true, error => {
        this.log("enabled control notifications")
        if (error) return reject(error)
        resolve(device)
      })
    })
  }

  async gattConnect(device) {
    await new Promise((resolve, reject) => {
      if (device.state === "connected") return resolve(device)
      device.connect(error => {
        if (error) return reject(error)
        resolve(device)
      })
    })
    this.log("connected to gatt server")
    const service = await this.getDFUService(device).catch(() => {
      throw new Error("Unable to find DFU service")
    })
    this.log("found DFU service")
    return this.getDFUCharacteristics(service)
  }

  disconnect(device) {
    this.log("complete, disconnecting...")
    this.state(STATES.DISCONNECTING)
    return new Promise((resolve, reject) => {
      device.disconnect(error => {
        if (error) {
          reject(error)
        }
      })
      device.once("disconnect", () => {
        this.log("disconnect")
        resolve()
      })
    })
  }

  getDFUService(device) {
    return new Promise((resolve, reject) => {
      device.discoverServices([SERVICE_UUID], (error, services) => {
        if (error) return reject(error)
        resolve(services[0])
      })
    })
  }

  getDFUCharacteristics(service) {
    return new Promise((resolve, reject) => {
      service.discoverCharacteristics([], (error, characteristics) => {
        if (error) return reject(error)
        resolve(characteristics)
      })
    })
  }

  setDfuMode(device) {
    return this.gattConnect(device).then(characteristics => {
      this.log(`found ${characteristics.length} characteristic(s)`)

      let controlChar = characteristics.find(characteristic => {
        return getCanonicalUUID(characteristic.uuid) === CONTROL_UUID
      })
      let packetChar = characteristics.find(characteristic => {
        return getCanonicalUUID(characteristic.uuid) === PACKET_UUID
      })

      if (controlChar && packetChar) {
        return device
      }

      let buttonChar = characteristics.find(characteristic => {
        return getCanonicalUUID(characteristic.uuid) === BUTTON_UUID
      })

      if (!buttonChar) {
        throw new Error("Unsupported device")
      }

      // Support buttonless devices
      this.log("found buttonless characteristic")
      if (!buttonChar.properties.includes("notify") && !buttonChar.properties.includes("indicate")) {
        throw new Error("Buttonless characteristic does not allow notifications")
      }

      return new Promise((resolve, reject) => {
        buttonChar.notify(true, error => {
          if (error) return reject(error)
          resolve()
        })
      })
        .then(() => {
          this.log("enabled buttonless notifications")
          buttonChar.on("data", this.handleNotification.bind(this))
          this.sendOperation(buttonChar, OPERATIONS.BUTTON_COMMAND)
        })
        .then(() => {
          this.log("sent dfu mode")
          return new Promise(resolve => {
            device.once("disconnect", () => {
              resolve()
            })
          })
        })
    })
  }

  handleNotification(data) {
    let view = bufferToDataView(data)

    if (OPERATIONS.RESPONSE.indexOf(view.getUint8(0)) < 0) {
      throw new Error("Unrecognised control characteristic response notification")
    }

    let operation = view.getUint8(1)
    if (this.notifyFns[operation]) {
      let result = view.getUint8(2)
      let error = null

      if (result === 0x01) {
        let data = new DataView(view.buffer, 3)
        this.notifyFns[operation].resolve(data)
      } else if (result === 0x0b) {
        let code = view.getUint8(3)
        error = `Error: ${EXTENDED_ERROR[code]}`
      } else {
        error = `Error: ${RESPONSE[result]}`
      }

      if (error) {
        this.error(error)
        this.notifyFns[operation].reject(error)
      }
      delete this.notifyFns[operation]
    }
  }

  sendControl(operation, buffer) {
    return this.sendOperation(this.controlChar, operation, buffer)
  }

  sendOperation(characteristic, operation, buffer) {
    return new Promise((resolve, reject) => {
      let size = operation.length
      if (buffer) size += buffer.byteLength

      let value = new Uint8Array(size)
      value.set(operation)
      if (buffer) {
        let data = new Uint8Array(buffer)
        value.set(data, operation.length)
      }

      this.notifyFns[operation[0]] = {
        resolve: resolve,
        reject: reject,
      }
      writeCharacteristic(characteristic, new Buffer(value), false)
    })
  }

  transferInit(buffer) {
    return this.transfer(buffer, "init", OPERATIONS.SELECT_COMMAND, OPERATIONS.CREATE_COMMAND)
  }

  transferFirmware(buffer) {
    return this.transfer(buffer, "firmware", OPERATIONS.SELECT_DATA, OPERATIONS.CREATE_DATA)
  }

  async transfer(buffer, type, selectType, createType) {
    this.bailOnAbort()

    const response = await this.sendControl(selectType)
    let maxSize = response.getUint32(0, LITTLE_ENDIAN)
    let offset = response.getUint32(4, LITTLE_ENDIAN)
    let crc = response.getInt32(8, LITTLE_ENDIAN)

    if (type === "init" && offset === buffer.byteLength && this.checkCrc(buffer, crc)) {
      this.log("init packet already available, skipping transfer")
      return
    }

    this.progress = function(bytes) {
      this.emit("progress", {
        object: type,
        totalBytes: buffer.byteLength,
        currentBytes: bytes,
      })
    }
    this.progress(0)

    return this.transferObject(buffer, createType, maxSize, offset)
  }

  async transferObject(buffer, createType, maxSize, offset) {
    this.bailOnAbort()

    let start = offset - offset % maxSize
    let end = Math.min(start + maxSize, buffer.byteLength)

    let view = new DataView(new ArrayBuffer(4))
    view.setUint32(0, end - start, LITTLE_ENDIAN)

    await this.sendControl(createType, view.buffer)
    let data = buffer.slice(start, end)
    await this.transferData(data, start)
    const response = await this.sendControl(OPERATIONS.CALCULATE_CHECKSUM)
    let crc = response.getInt32(4, LITTLE_ENDIAN)
    let transferred = response.getUint32(0, LITTLE_ENDIAN)
    let responsedata = buffer.slice(0, transferred)

    if (this.checkCrc(responsedata, crc)) {
      this.log(`written ${transferred} bytes`)
      offset = transferred
      await this.sendControl(OPERATIONS.EXECUTE)
    } else {
      this.error("object failed to validate")
    }
    if (end < buffer.byteLength) {
      await this.transferObject(buffer, createType, maxSize, offset)
    } else {
      this.log("transfer complete")
    }
  }

  async transferData(data, offset, start) {
    start = start || 0
    let end = Math.min(start + PACKET_SIZE, data.byteLength)
    let packet = data.slice(start, end)

    const buffer = new Buffer(packet)

    await writeCharacteristic(this.packetChar, buffer)
    this.progress(offset + end)

    if (end < data.byteLength) {
      return this.transferData(data, offset, end)
    }
  }

  checkCrc(buffer, crc) {
    if (!this.crc32) {
      this.log("crc32 not found, skipping CRC check")
      return true
    }

    return crc === this.crc32(new Uint8Array(buffer))
  }

  bailOnAbort() {
    if (this.isAborted) {
      this.state(STATES.ABORTED)
      throw new Error("aborted")
    }
  }
}

function bufferToDataView(buffer) {
  // Buffer to ArrayBuffer
  var arrayBuffer = new Uint8Array(buffer).buffer
  return new DataView(arrayBuffer)
}

function dataViewToBuffer(dataView) {
  // DataView to TypedArray
  var typedArray = new Uint8Array(dataView.buffer)
  return new Buffer(typedArray)
}

function getCanonicalUUID(uuid) {
  if (typeof uuid === "number") uuid = uuid.toString(16)
  uuid = uuid.toLowerCase()
  if (uuid.length <= 8) uuid = ("00000000" + uuid).slice(-8) + "-0000-1000-8000-00805f9b34fb"
  if (uuid.length === 32)
    uuid = uuid
      .match(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/)
      .splice(1)
      .join("-")
  return uuid
}

const isWindows = /^win32/.test(process.platform)

const defaultWithoutResponse = !isWindows

function writeCharacteristic(characteristic, buffer, withoutResponse = defaultWithoutResponse) {
  return new Promise((resolve, reject) => {
    characteristic.write(buffer, withoutResponse, error => {
      if (error) return reject(error)
      resolve()
    })
  })
}
