"use strict"
require("babel-polyfill")

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
        reject("disconnected")
      })
    })

    await Promise.race([this.doUpdate(device, init, firmware), disconnectWatcher])
    return this.disconnect(device)
  }

  async doUpdate(device, init, firmware) {
    await this.connect(device)
    this.log("transferring init")
    this.state(STATES.STARTING)
    // await this.transferInit(init, 3)
    await this.sendInitPacket(init)
    this.log("transferring firmware")
    this.state(STATES.UPLOADING)
    // await this.transferFirmware(init, firmware, 3)
    await this.sendFirmware(firmware)
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

  async sendInitPacket(buffer) {
    this.bailOnAbort()
    let initPacketSizeInBytes = buffer.byteLength
    // First, select the Command Object. As a response the maximum command size and information whether there is already
    // a command saved from a previous connection is returned.
    this.log("requesting init state")
    const response = await this.sendControl(OPERATIONS.SELECT_COMMAND)
    let maxSize = response.getUint32(0, LITTLE_ENDIAN)
    let offset = response.getUint32(4, LITTLE_ENDIAN)
    let crc = response.getInt32(8, LITTLE_ENDIAN)
    this.log(`received maxSize: ${maxSize}, offset: ${offset}, crc: ${crc}`)

    // Can we resume? If the offset obtained from the device is greater then zero we can compare it with the local init packet CRC
    // and resume sending the init packet, or even skip sending it if the whole file was sent before.
    let skipSendingInitPacket = false
    let resumeSendingInitPacket = false
    if (offset > 0 && offset <= initPacketSizeInBytes) {
      this.log(`offset is between 0 and buffer size (${initPacketSizeInBytes})`)
      // Read the same number of bytes from the current init packet to calculate local CRC32
      let transferred = buffer.slice(0, offset)
      this.log(transferred.byteLength)
      // Calculate the CRC32
      if (this.checkCrc(transferred, crc)) {
        if (offset === initPacketSizeInBytes) {
          this.log("The offset equals the init package size. Will skip sending init package")
          // The whole init packet was sent and it is equal to one we try to send now.
          // There is no need to send it again. We may try to resume sending data.
          skipSendingInitPacket = true
        } else {
          this.log("The offset is not equal to the init package size. Will resume sending init package")
          resumeSendingInitPacket = true
        }
      } else {
        this.log("A different init package was sent before, or an error occurred while sending. Resending")
        // A different Init packet was sent before, or the error occurred while sending.
        // We have to send the whole Init packet again.
        offset = 0
      }
    }

    if (!skipSendingInitPacket) {
      for (let attempt = 1; attempt <= 3; ) {
        if (!resumeSendingInitPacket) {
          // Create the Init object
          // private static final int OP_CODE_CREATE_KEY = 0x01;
          // private static final int OBJECT_COMMAND = 0x01;
          this.log("creating init object")
          const view = new DataView(new ArrayBuffer(4))
          view.setUint32(0, initPacketSizeInBytes, LITTLE_ENDIAN)
          await this.sendControl(OPERATIONS.CREATE_COMMAND, view.buffer)
          this.log("creat command finished")
        } else {
          this.log(`resuming sending init package: attempt ${attempt}`)
        }
        // Write Init data to the Packet Characteristic
        let data = buffer.slice(offset)
        this.log(`transfering data starting with offset: ${offset}`)
        await this.transferData(data, offset)
        this.log("transferred data")

        // Calculate Checksum
        this.log("Calculating checksum")
        const response = await this.sendControl(OPERATIONS.CALCULATE_CHECKSUM)
        let crc = response.getInt32(4, LITTLE_ENDIAN)
        let transferred = response.getUint32(0, LITTLE_ENDIAN)
        let responsedata = buffer.slice(0, transferred)
        this.log(`Received checksum: crc: ${crc}, transferred: ${transferred}`)

        if (this.checkCrc(responsedata, crc)) {
          this.log("checksum ok")
          // Everything is OK, we can proceed
          break
        } else if (attempt < 3) {
          this.log(`Starting next attempt #${attempt}`)
          attempt++
          // Go back to the beginning, we will send the whole Init packet again
          resumeSendingInitPacket = false
          offset = 0
        } else {
          this.error("crc doesn't match")
          this.log("crc doesn't match")
          return false
        }
      }
    } else {
      this.log("skipped sending init package")
    }

    // Execute Init packet. It's better to execute it twice than not execute at all...
    this.log("executing")
    await this.sendControl(OPERATIONS.EXECUTE)
    this.log("finished executing")
    return true
  }

  async sendFirmware(buffer) {
    this.bailOnAbort()
    // SELECT_DATA: [0x06, 0x02],
    this.log("requesting firmware state")
    const response = await this.sendControl(OPERATIONS.SELECT_DATA)
    let maxSize = response.getUint32(0, LITTLE_ENDIAN)
    let offset = response.getUint32(4, LITTLE_ENDIAN)
    let crc = response.getInt32(8, LITTLE_ENDIAN)
    this.log(`received maxSize: ${maxSize}, offset: ${offset}, crc: ${crc}`)

    let imageSizeInBytes = buffer.byteLength

    // Number of chunks in which the data will be sent
    const chunkCount = (imageSizeInBytes + maxSize - 1) / maxSize
    let currentChunk = 0
    let resumeSendingData = false

    // Can we resume? If the offset obtained from the device is greater then zero we can compare it with the local CRC
    // and resume sending the data.
    if (offset > 0) {
      currentChunk = offset / maxSize
      let bytesSentAndExecuted = maxSize * currentChunk
      let bytesSentNotExecuted = offset - bytesSentAndExecuted

      // If the offset is dividable by maxSize, assume that the last page was not executed
      if (bytesSentNotExecuted === 0) {
        bytesSentAndExecuted -= maxSize
        bytesSentNotExecuted = maxSize
      }

      let transferred = buffer.slice(0, offset)
      if (this.checkCrc(transferred, crc)) {
        // If the whole page was sent and CRC match, we have to make sure it was executed
        if (bytesSentNotExecuted === maxSize && offset < imageSizeInBytes) {
          this.log("firmware already transferred")
          this.log("executing")
          await this.sendControl(OPERATIONS.EXECUTE)
          this.log("finished executing")
        } else {
          resumeSendingData = true
        }
      } else {
        // The CRC of the current object is not correct. If there was another Data object sent before, its CRC must have been correct,
        // as it has been executed. Either way, we have to create the current object again.
        offset -= bytesSentNotExecuted
      }
    }

    if (offset < imageSizeInBytes) {
      let attempt = 1
      let end = 0
      // Each page will be sent in MAX_ATTEMPTS
      do {
        this.log(`starting attempt #${attempt}`)
        let start = offset - offset % maxSize
        end = Math.min(start + maxSize, buffer.byteLength)
        if (!resumeSendingData) {
          // Create the Data object
          let view = new DataView(new ArrayBuffer(4))
          view.setUint32(0, end - start, LITTLE_ENDIAN)
          this.log(`creating data object: size: ${end - start}`)
          await this.sendControl(OPERATIONS.CREATE_DATA, view.buffer)
        } else {
          resumeSendingData = false
        }

        let data = buffer.slice(start, end)
        this.log(`transfering data starting with offset: ${offset}`)
        await this.transferData(data, start)
        this.log("transferred data")

        // Calculate Checksum
        this.log("Calculating checksum")
        const response = await this.sendControl(OPERATIONS.CALCULATE_CHECKSUM)
        crc = response.getInt32(4, LITTLE_ENDIAN)
        let transferred = response.getUint32(0, LITTLE_ENDIAN)
        this.log(`Received checksum: crc: ${crc}, transferred: ${transferred}`)

        // It may happen, that not all bytes that were sent were received by the remote device
        const bytesLost = end - transferred
        this.log(`Bytes lost: ${bytesLost}`)

        let responsedata = buffer.slice(0, transferred)
        if (this.checkCrc(responsedata, crc)) {
          if (bytesLost > 0) {
            resumeSendingData = true
            continue
          }
          this.log(`written ${transferred} bytes`)
          await this.sendControl(OPERATIONS.EXECUTE)
          // Increment iterator
          currentChunk++
          attempt = 1
          offset = transferred

          this.log(`Next chunk: currentChunk: ${currentChunk}, attempt: ${attempt}, offset: ${offset}`)
        } else if (attempt < MAX_ATTEMPTS) {
          // try again with same offset
          this.log(`Starting next attempt: ${attempt}`)
          attempt++
        } else {
          this.error("crc doesn't match")
          this.log("crc doesn't match")
          return false
        }
      } while (end < buffer.byteLength)
    } else {
      // Looks as if the whole file was sent correctly but has not been executed
      this.log("Executing")
      await this.sendControl(OPERATIONS.EXECUTE)
      this.log("Finished executing")
    }
    return true
  }

  async transferInit(buffer, tryCount, forceInit) {
    this.bailOnAbort()

    const response = await this.sendControl(OPERATIONS.SELECT_COMMAND)
    let maxSize = response.getUint32(0, LITTLE_ENDIAN)
    let offset = response.getUint32(4, LITTLE_ENDIAN)
    let crc = response.getInt32(8, LITTLE_ENDIAN)

    if (forceInit) {
      this.log("forced init retransferring init")
      offset = 0
    } else if (!forceInit && offset === buffer.byteLength && this.checkCrc(buffer, crc)) {
      // await this.sendControl(OPERATIONS.EXECUTE)
      this.log("init packet already available, skipping transfer")
      return
    }

    let transferred = buffer.slice(0, offset)
    if (!this.checkCrc(transferred, crc)) {
      tryCount--
      if (tryCount === 0) {
        throw new Error("could not validate init packet")
      }
      this.log("init crc check failed retrying")
      return this.transferInit(buffer, tryCount, true)
    }
    this.log(`init resuming transfer at ${offset} with max size ${maxSize}`)

    this.progress = function(bytes) {
      this.emit("progress", {
        object: "init",
        totalBytes: buffer.byteLength,
        currentBytes: bytes,
      })
    }
    this.progress(0)

    return this.transferObject(buffer, OPERATIONS.CREATE_COMMAND, maxSize, offset)
  }

  async transferFirmware(initBuffer, buffer, tryCount) {
    this.bailOnAbort()

    const response = await this.sendControl(OPERATIONS.SELECT_DATA)
    let maxSize = response.getUint32(0, LITTLE_ENDIAN)
    let offset = response.getUint32(4, LITTLE_ENDIAN)
    let crc = response.getInt32(8, LITTLE_ENDIAN)

    let transferred = buffer.slice(0, offset)
    if (!this.checkCrc(transferred, crc)) {
      tryCount--
      if (tryCount == 0) {
        throw new Error("could not validate firmware packet")
      }
      this.log(`firmware crc check failed retrying ${offset}`)
      //await this.transferInit(initBuffer, 3, true)
      // return this.transferFirmware(initBuffer, buffer, tryCount)
      offset = 0
    }
    this.log(`firmware resuming transfer at ${offset} with max size ${maxSize}`)

    this.progress = function(bytes) {
      this.emit("progress", {
        object: "firmware",
        totalBytes: buffer.byteLength,
        currentBytes: bytes,
      })
    }
    this.progress(0)

    return this.transferObject(buffer, OPERATIONS.CREATE_DATA, maxSize, offset)
  }

  async transferObject(buffer, createType, maxSize, offset) {
    this.bailOnAbort()

    let start = offset - offset % maxSize
    let end = Math.min(start + maxSize, buffer.byteLength)
    this.log(`transfer object from ${start}-${end} total size ${buffer.byteLength} bytes`)
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

    this.log(`Writing from ${start} to ${end}`)
    await writeCharacteristic(this.packetChar, buffer)
    this.log("Finished writing")
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

    const ourCrc = this.crc32(new Uint8Array(buffer))
    this.log(`Our calculated crc: ${ourCrc}, received: ${crc}`)
    return crc === ourCrc
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
