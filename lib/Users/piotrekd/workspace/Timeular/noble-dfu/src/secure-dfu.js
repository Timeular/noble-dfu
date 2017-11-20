"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SecureDFU = exports.STATES = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require("events");

var _events2 = _interopRequireDefault(_events);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var SERVICE_UUID = "fe59";
var CONTROL_UUID = "8ec90001-f315-4f60-9fb8-838830daea50";
var PACKET_UUID = "8ec90002-f315-4f60-9fb8-838830daea50";
var BUTTON_UUID = "8ec90003-f315-4f60-9fb8-838830daea50";

var LITTLE_ENDIAN = true;
var PACKET_SIZE = 20;

var OPERATIONS = {
  BUTTON_COMMAND: [0x01],
  CREATE_COMMAND: [0x01, 0x01],
  CREATE_DATA: [0x01, 0x02],
  RECEIPT_NOTIFICATIONS: [0x02],
  CALCULATE_CHECKSUM: [0x03],
  EXECUTE: [0x04],
  SELECT_COMMAND: [0x06, 0x01],
  SELECT_DATA: [0x06, 0x02],
  RESPONSE: [0x60, 0x20]
};

var RESPONSE = {
  0x00: "Invalid code", // Invalid opcode.
  0x01: "Success", // Operation successful.
  0x02: "Opcode not supported", // Opcode not supported.
  0x03: "Invalid parameter", // Missing or invalid parameter value.
  0x04: "Insufficient resources", // Not enough memory for the data object.
  0x05: "Invalid object", // Data object does not match the firmware and hardware requirements, the signature is wrong, or parsing the command failed.
  0x07: "Unsupported type", // Not a valid object type for a Create request.
  0x08: "Operation not permitted", // The state of the DFU process does not allow this operation.
  0x0a: "Operation failed", // Operation failed.
  0x0b: "Extended error" // Extended error.
};

var EXTENDED_ERROR = {
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
  0x0d: "Insufficient space" // The available space on the device is insufficient to hold the firmware.
};

var STATES = exports.STATES = {
  CONNECTING: 0,
  STARTING: 1,
  UPLOADING: 3,
  DISCONNECTING: 5,
  COMPLETED: 6,
  ABORTED: 7
};

var SecureDFU = function (_EventEmitter) {
  _inherits(SecureDFU, _EventEmitter);

  function SecureDFU(crc) {
    _classCallCheck(this, SecureDFU);

    var _this = _possibleConstructorReturn(this, (SecureDFU.__proto__ || Object.getPrototypeOf(SecureDFU)).call(this));

    _this.crc32 = crc;
    _this.events = {};
    _this.notifyFns = {};
    _this.controlChar = null;
    _this.packetChar = null;
    _this.isAborted = false;
    return _this;
  }

  _createClass(SecureDFU, [{
    key: "log",
    value: function log(message) {
      this.emit("log", { message: message });
    }
  }, {
    key: "error",
    value: function error(err) {
      this.emit("error", err);
    }
  }, {
    key: "state",
    value: function state(_state) {
      this.emit("stateChanged", { state: _state });
    }
  }, {
    key: "progress",
    value: function progress(bytes) {
      this.emit("progress", {
        object: "unknown",
        totalBytes: 0,
        currentBytes: bytes
      });
    }
  }, {
    key: "update",
    value: function update(device, init, firmware) {
      var _this2 = this;

      this.isAborted = false;

      if (!device) throw new Error("Device not specified");
      if (!init) throw new Error("Init not specified");
      if (!firmware) throw new Error("Firmware not specified");

      this.state(STATES.CONNECTING);

      return this.connect(device).then(function () {
        _this2.log("transferring init");
        _this2.state(STATES.STARTING);
        return _this2.transferInit(init);
      }).then(function () {
        _this2.log("transferring firmware");
        _this2.state(STATES.UPLOADING);
        return _this2.transferFirmware(firmware);
      }).then(function () {
        _this2.state(STATES.COMPLETED);
      }).then(function () {
        return _this2.disconnect(device);
      });
    }
  }, {
    key: "abort",
    value: function abort() {
      this.isAborted = true;
    }
  }, {
    key: "connect",
    value: function connect(device) {
      var _this3 = this;

      device.once("disconnect", function () {
        _this3.controlChar = null;
        _this3.packetChar = null;
      });

      return this.gattConnect(device).then(function (characteristics) {
        _this3.log("found " + characteristics.length + " characteristic(s)");

        _this3.packetChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === PACKET_UUID;
        });
        if (!_this3.packetChar) throw new Error("Unable to find packet characteristic");
        _this3.log("found packet characteristic");

        _this3.controlChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === CONTROL_UUID;
        });
        if (!_this3.controlChar) throw new Error("Unable to find control characteristic");
        _this3.log("found control characteristic");

        if (!_this3.controlChar.properties.includes("notify") && !_this3.controlChar.properties.includes("indicate")) {
          throw new Error("Control characteristic does not allow notifications");
        }
        _this3.controlChar.on("data", _this3.handleNotification.bind(_this3));
        return new Promise(function (resolve, reject) {
          _this3.controlChar.notify(true, function (error) {
            _this3.log("enabled control notifications");
            if (error) return reject(error);
            resolve(device);
          });
        });
      });
    }
  }, {
    key: "gattConnect",
    value: function gattConnect(device) {
      var _this4 = this;

      return new Promise(function (resolve, reject) {
        if (device.state === "connected") return resolve(device);
        device.connect(function (error) {
          if (error) return reject(error);
          resolve(device);
        });
      }).then(function (device) {
        _this4.log("connected to gatt server");
        return _this4.getDFUService(device).catch(function () {
          throw new Error("Unable to find DFU service");
        });
      }).then(function (service) {
        _this4.log("found DFU service");
        return _this4.getDFUCharacteristics(service);
      });
    }
  }, {
    key: "disconnect",
    value: function disconnect(device) {
      var _this5 = this;

      this.log("complete, disconnecting...");
      this.state(STATES.DISCONNECTING);
      return new Promise(function (resolve, reject) {
        device.disconnect(function (error) {
          if (error) {
            reject(error);
          }
        });
        device.once("disconnect", function () {
          _this5.log("disconnect");
          resolve();
        });
      });
    }
  }, {
    key: "getDFUService",
    value: function getDFUService(device) {
      return new Promise(function (resolve, reject) {
        device.discoverServices([SERVICE_UUID], function (error, services) {
          if (error) return reject(error);
          resolve(services[0]);
        });
      });
    }
  }, {
    key: "getDFUCharacteristics",
    value: function getDFUCharacteristics(service) {
      return new Promise(function (resolve, reject) {
        service.discoverCharacteristics([], function (error, characteristics) {
          if (error) return reject(error);
          resolve(characteristics);
        });
      });
    }
  }, {
    key: "setDfuMode",
    value: function setDfuMode(device) {
      var _this6 = this;

      return this.gattConnect(device).then(function (characteristics) {
        _this6.log("found " + characteristics.length + " characteristic(s)");

        var controlChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === CONTROL_UUID;
        });
        var packetChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === PACKET_UUID;
        });

        if (controlChar && packetChar) {
          return device;
        }

        var buttonChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === BUTTON_UUID;
        });

        if (!buttonChar) {
          throw new Error("Unsupported device");
        }

        // Support buttonless devices
        _this6.log("found buttonless characteristic");
        if (!buttonChar.properties.includes("notify") && !buttonChar.properties.includes("indicate")) {
          throw new Error("Buttonless characteristic does not allow notifications");
        }

        return new Promise(function (resolve, reject) {
          buttonChar.notify(true, function (error) {
            if (error) return reject(error);
            resolve();
          });
        }).then(function () {
          _this6.log("enabled buttonless notifications");
          buttonChar.on("data", _this6.handleNotification.bind(_this6));
          _this6.sendOperation(buttonChar, OPERATIONS.BUTTON_COMMAND);
        }).then(function () {
          _this6.log("sent dfu mode");
          return new Promise(function (resolve) {
            device.once("disconnect", function () {
              resolve();
            });
          });
        });
      });
    }
  }, {
    key: "handleNotification",
    value: function handleNotification(data) {
      var view = bufferToDataView(data);

      if (OPERATIONS.RESPONSE.indexOf(view.getUint8(0)) < 0) {
        throw new Error("Unrecognised control characteristic response notification");
      }

      var operation = view.getUint8(1);
      if (this.notifyFns[operation]) {
        var result = view.getUint8(2);
        var error = null;

        if (result === 0x01) {
          var _data = new DataView(view.buffer, 3);
          this.notifyFns[operation].resolve(_data);
        } else if (result === 0x0b) {
          var code = view.getUint8(3);
          error = "Error: " + EXTENDED_ERROR[code];
        } else {
          error = "Error: " + RESPONSE[result];
        }

        if (error) {
          this.error(error);
          this.notifyFns[operation].reject(error);
        }
        delete this.notifyFns[operation];
      }
    }
  }, {
    key: "sendControl",
    value: function sendControl(operation, buffer) {
      return this.sendOperation(this.controlChar, operation, buffer);
    }
  }, {
    key: "sendOperation",
    value: function sendOperation(characteristic, operation, buffer) {
      var _this7 = this;

      return new Promise(function (resolve, reject) {
        var size = operation.length;
        if (buffer) size += buffer.byteLength;

        var value = new Uint8Array(size);
        value.set(operation);
        if (buffer) {
          var data = new Uint8Array(buffer);
          value.set(data, operation.length);
        }

        _this7.notifyFns[operation[0]] = {
          resolve: resolve,
          reject: reject
        };
        writeCharacteristic(characteristic, new Buffer(value), false);
      });
    }
  }, {
    key: "transferInit",
    value: function transferInit(buffer) {
      return this.transfer(buffer, "init", OPERATIONS.SELECT_COMMAND, OPERATIONS.CREATE_COMMAND);
    }
  }, {
    key: "transferFirmware",
    value: function transferFirmware(buffer) {
      return this.transfer(buffer, "firmware", OPERATIONS.SELECT_DATA, OPERATIONS.CREATE_DATA);
    }
  }, {
    key: "transfer",
    value: function transfer(buffer, type, selectType, createType) {
      var _this8 = this;

      this.bailOnAbort();

      return this.sendControl(selectType).then(function (response) {
        var maxSize = response.getUint32(0, LITTLE_ENDIAN);
        var offset = response.getUint32(4, LITTLE_ENDIAN);
        var crc = response.getInt32(8, LITTLE_ENDIAN);

        if (type === "init" && offset === buffer.byteLength && _this8.checkCrc(buffer, crc)) {
          _this8.log("init packet already available, skipping transfer");
          return;
        }

        _this8.progress = function (bytes) {
          this.emit("progress", {
            object: type,
            totalBytes: buffer.byteLength,
            currentBytes: bytes
          });
        };
        _this8.progress(0);

        return _this8.transferObject(buffer, createType, maxSize, offset);
      });
    }
  }, {
    key: "transferObject",
    value: function transferObject(buffer, createType, maxSize, offset) {
      var _this9 = this;

      this.bailOnAbort();

      var start = offset - offset % maxSize;
      var end = Math.min(start + maxSize, buffer.byteLength);

      var view = new DataView(new ArrayBuffer(4));
      view.setUint32(0, end - start, LITTLE_ENDIAN);

      return this.sendControl(createType, view.buffer).then(function () {
        var data = buffer.slice(start, end);
        return _this9.transferData(data, start);
      }).then(function () {
        return _this9.sendControl(OPERATIONS.CALCULATE_CHECKSUM);
      }).then(function (response) {
        var crc = response.getInt32(4, LITTLE_ENDIAN);
        var transferred = response.getUint32(0, LITTLE_ENDIAN);
        var data = buffer.slice(0, transferred);

        if (_this9.checkCrc(data, crc)) {
          _this9.log("written " + transferred + " bytes");
          offset = transferred;
          return _this9.sendControl(OPERATIONS.EXECUTE);
        } else {
          _this9.error("object failed to validate");
        }
      }).then(function () {
        if (end < buffer.byteLength) {
          return _this9.transferObject(buffer, createType, maxSize, offset);
        } else {
          _this9.log("transfer complete");
        }
      });
    }
  }, {
    key: "transferData",
    value: function transferData(data, offset, start) {
      var _this10 = this;

      start = start || 0;
      var end = Math.min(start + PACKET_SIZE, data.byteLength);
      var packet = data.slice(start, end);

      var buffer = new Buffer(packet);

      return writeCharacteristic(this.packetChar, buffer).then(function () {
        _this10.progress(offset + end);

        if (end < data.byteLength) {
          return _this10.transferData(data, offset, end);
        }
      });
    }
  }, {
    key: "checkCrc",
    value: function checkCrc(buffer, crc) {
      if (!this.crc32) {
        this.log("crc32 not found, skipping CRC check");
        return true;
      }

      return crc === this.crc32(new Uint8Array(buffer));
    }
  }, {
    key: "bailOnAbort",
    value: function bailOnAbort() {
      if (this.isAborted) {
        this.state(STATES.ABORTED);
        throw new Error("aborted");
      }
    }
  }]);

  return SecureDFU;
}(_events2.default);

exports.SecureDFU = SecureDFU;
SecureDFU.SERVICE_UUID = SERVICE_UUID;


function bufferToDataView(buffer) {
  // Buffer to ArrayBuffer
  var arrayBuffer = new Uint8Array(buffer).buffer;
  return new DataView(arrayBuffer);
}

function dataViewToBuffer(dataView) {
  // DataView to TypedArray
  var typedArray = new Uint8Array(dataView.buffer);
  return new Buffer(typedArray);
}

function getCanonicalUUID(uuid) {
  if (typeof uuid === "number") uuid = uuid.toString(16);
  uuid = uuid.toLowerCase();
  if (uuid.length <= 8) uuid = ("00000000" + uuid).slice(-8) + "-0000-1000-8000-00805f9b34fb";
  if (uuid.length === 32) uuid = uuid.match(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/).splice(1).join("-");
  return uuid;
}

var isWindows = /^win32/.test(process.platform);

var defaultWithoutResponse = !isWindows;

function writeCharacteristic(characteristic, buffer) {
  var withoutResponse = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : defaultWithoutResponse;

  return new Promise(function (resolve, reject) {
    characteristic.write(buffer, withoutResponse, function (error) {
      if (error) return reject(error);
      resolve();
    });
  });
}