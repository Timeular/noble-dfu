"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SecureDFU = exports.STATES = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require("events");

var _events2 = _interopRequireDefault(_events);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

require("babel-polyfill");

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
    value: function () {
      var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(device, init, firmware) {
        var _this2 = this;

        var disconnectWatcher;
        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                this.isAborted = false;

                if (device) {
                  _context.next = 3;
                  break;
                }

                throw new Error("Device not specified");

              case 3:
                if (init) {
                  _context.next = 5;
                  break;
                }

                throw new Error("Init not specified");

              case 5:
                if (firmware) {
                  _context.next = 7;
                  break;
                }

                throw new Error("Firmware not specified");

              case 7:

                this.state(STATES.CONNECTING);
                disconnectWatcher = new Promise(function (resolve, reject) {
                  device.once("disconnect", function () {
                    _this2.controlChar = null;
                    _this2.packetChar = null;
                    reject('disconnected');
                  });
                });
                _context.next = 11;
                return Promise.race([this.doUpdate(device, init, firmware), disconnectWatcher]);

              case 11:
                return _context.abrupt("return", this.disconnect(device));

              case 12:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this);
      }));

      function update(_x, _x2, _x3) {
        return _ref.apply(this, arguments);
      }

      return update;
    }()
  }, {
    key: "doUpdate",
    value: function () {
      var _ref2 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2(device, init, firmware) {
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                _context2.next = 2;
                return this.connect(device);

              case 2:
                this.log("transferring init");
                this.state(STATES.STARTING);
                _context2.next = 6;
                return this.transferInit(init);

              case 6:
                this.log("transferring firmware");
                this.state(STATES.UPLOADING);
                _context2.next = 10;
                return this.transferFirmware(firmware);

              case 10:
                this.state(STATES.COMPLETED);

              case 11:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this);
      }));

      function doUpdate(_x4, _x5, _x6) {
        return _ref2.apply(this, arguments);
      }

      return doUpdate;
    }()
  }, {
    key: "abort",
    value: function abort() {
      this.isAborted = true;
    }
  }, {
    key: "connect",
    value: function () {
      var _ref3 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3(device) {
        var _this3 = this;

        var characteristics;
        return regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                _context3.next = 2;
                return this.gattConnect(device);

              case 2:
                characteristics = _context3.sent;

                this.log("found " + characteristics.length + " characteristic(s)");

                this.packetChar = characteristics.find(function (characteristic) {
                  return getCanonicalUUID(characteristic.uuid) === PACKET_UUID;
                });

                if (this.packetChar) {
                  _context3.next = 7;
                  break;
                }

                throw new Error("Unable to find packet characteristic");

              case 7:
                this.log("found packet characteristic");

                this.controlChar = characteristics.find(function (characteristic) {
                  return getCanonicalUUID(characteristic.uuid) === CONTROL_UUID;
                });

                if (this.controlChar) {
                  _context3.next = 11;
                  break;
                }

                throw new Error("Unable to find control characteristic");

              case 11:
                this.log("found control characteristic");

                if (!(!this.controlChar.properties.includes("notify") && !this.controlChar.properties.includes("indicate"))) {
                  _context3.next = 14;
                  break;
                }

                throw new Error("Control characteristic does not allow notifications");

              case 14:
                this.controlChar.on("data", this.handleNotification.bind(this));
                return _context3.abrupt("return", new Promise(function (resolve, reject) {
                  _this3.controlChar.notify(true, function (error) {
                    _this3.log("enabled control notifications");
                    if (error) return reject(error);
                    resolve(device);
                  });
                }));

              case 16:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3, this);
      }));

      function connect(_x7) {
        return _ref3.apply(this, arguments);
      }

      return connect;
    }()
  }, {
    key: "gattConnect",
    value: function () {
      var _ref4 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee4(device) {
        var service;
        return regeneratorRuntime.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                _context4.next = 2;
                return new Promise(function (resolve, reject) {
                  if (device.state === "connected") return resolve(device);
                  device.connect(function (error) {
                    if (error) return reject(error);
                    resolve(device);
                  });
                });

              case 2:
                this.log("connected to gatt server");
                _context4.next = 5;
                return this.getDFUService(device).catch(function () {
                  throw new Error("Unable to find DFU service");
                });

              case 5:
                service = _context4.sent;

                this.log("found DFU service");
                return _context4.abrupt("return", this.getDFUCharacteristics(service));

              case 8:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this);
      }));

      function gattConnect(_x8) {
        return _ref4.apply(this, arguments);
      }

      return gattConnect;
    }()
  }, {
    key: "disconnect",
    value: function disconnect(device) {
      var _this4 = this;

      this.log("complete, disconnecting...");
      this.state(STATES.DISCONNECTING);
      return new Promise(function (resolve, reject) {
        device.disconnect(function (error) {
          if (error) {
            reject(error);
          }
        });
        device.once("disconnect", function () {
          _this4.log("disconnect");
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
      var _this5 = this;

      return this.gattConnect(device).then(function (characteristics) {
        _this5.log("found " + characteristics.length + " characteristic(s)");

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
        _this5.log("found buttonless characteristic");
        if (!buttonChar.properties.includes("notify") && !buttonChar.properties.includes("indicate")) {
          throw new Error("Buttonless characteristic does not allow notifications");
        }

        return new Promise(function (resolve, reject) {
          buttonChar.notify(true, function (error) {
            if (error) return reject(error);
            resolve();
          });
        }).then(function () {
          _this5.log("enabled buttonless notifications");
          buttonChar.on("data", _this5.handleNotification.bind(_this5));
          _this5.sendOperation(buttonChar, OPERATIONS.BUTTON_COMMAND);
        }).then(function () {
          _this5.log("sent dfu mode");
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
      var _this6 = this;

      return new Promise(function (resolve, reject) {
        var size = operation.length;
        if (buffer) size += buffer.byteLength;

        var value = new Uint8Array(size);
        value.set(operation);
        if (buffer) {
          var data = new Uint8Array(buffer);
          value.set(data, operation.length);
        }

        _this6.notifyFns[operation[0]] = {
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
    value: function () {
      var _ref5 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee5(buffer, type, selectType, createType) {
        var response, maxSize, offset, crc;
        return regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                this.bailOnAbort();

                _context5.next = 3;
                return this.sendControl(selectType);

              case 3:
                response = _context5.sent;
                maxSize = response.getUint32(0, LITTLE_ENDIAN);
                offset = response.getUint32(4, LITTLE_ENDIAN);
                crc = response.getInt32(8, LITTLE_ENDIAN);

                if (!(type === "init" && offset === buffer.byteLength && this.checkCrc(buffer, crc))) {
                  _context5.next = 10;
                  break;
                }

                this.log("init packet already available, skipping transfer");
                return _context5.abrupt("return");

              case 10:
                // check crc of firmware/init if fail retry 3 times
                if (type === "firmware") {
                  console.log('firmware offset ', offset, maxSize);
                  // maxSize = 1024
                }

                this.progress = function (bytes) {
                  this.emit("progress", {
                    object: type,
                    totalBytes: buffer.byteLength,
                    currentBytes: bytes
                  });
                };
                this.progress(0);

                return _context5.abrupt("return", this.transferObject(buffer, createType, maxSize, offset));

              case 14:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this);
      }));

      function transfer(_x9, _x10, _x11, _x12) {
        return _ref5.apply(this, arguments);
      }

      return transfer;
    }()
  }, {
    key: "transferObject",
    value: function () {
      var _ref6 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee6(buffer, createType, maxSize, offset) {
        var start, end, view, data, response, crc, transferred, responsedata;
        return regeneratorRuntime.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                this.bailOnAbort();

                start = offset - offset % maxSize;
                end = Math.min(start + maxSize, buffer.byteLength);
                view = new DataView(new ArrayBuffer(4));

                view.setUint32(0, end - start, LITTLE_ENDIAN);

                _context6.next = 7;
                return this.sendControl(createType, view.buffer);

              case 7:
                data = buffer.slice(start, end);
                _context6.next = 10;
                return this.transferData(data, start);

              case 10:
                _context6.next = 12;
                return this.sendControl(OPERATIONS.CALCULATE_CHECKSUM);

              case 12:
                response = _context6.sent;
                crc = response.getInt32(4, LITTLE_ENDIAN);
                transferred = response.getUint32(0, LITTLE_ENDIAN);
                responsedata = buffer.slice(0, transferred);

                if (!this.checkCrc(responsedata, crc)) {
                  _context6.next = 23;
                  break;
                }

                this.log("written " + transferred + " bytes");
                offset = transferred;
                _context6.next = 21;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 21:
                _context6.next = 24;
                break;

              case 23:
                this.error("object failed to validate");

              case 24:
                if (!(end < buffer.byteLength)) {
                  _context6.next = 29;
                  break;
                }

                _context6.next = 27;
                return this.transferObject(buffer, createType, maxSize, offset);

              case 27:
                _context6.next = 30;
                break;

              case 29:
                this.log("transfer complete");

              case 30:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this);
      }));

      function transferObject(_x13, _x14, _x15, _x16) {
        return _ref6.apply(this, arguments);
      }

      return transferObject;
    }()
  }, {
    key: "transferData",
    value: function () {
      var _ref7 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee7(data, offset, start) {
        var end, packet, buffer;
        return regeneratorRuntime.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                start = start || 0;
                end = Math.min(start + PACKET_SIZE, data.byteLength);
                packet = data.slice(start, end);
                buffer = new Buffer(packet);
                _context7.next = 6;
                return writeCharacteristic(this.packetChar, buffer);

              case 6:
                this.progress(offset + end);

                if (!(end < data.byteLength)) {
                  _context7.next = 9;
                  break;
                }

                return _context7.abrupt("return", this.transferData(data, offset, end));

              case 9:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this);
      }));

      function transferData(_x17, _x18, _x19) {
        return _ref7.apply(this, arguments);
      }

      return transferData;
    }()
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