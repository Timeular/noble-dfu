"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SecureDFU = exports.promiseTimeout = exports.STATES = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require("events");

var _events2 = _interopRequireDefault(_events);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

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

var promiseTimeout = exports.promiseTimeout = function promiseTimeout(ms, promise) {
  var timeout = new Promise(function (resolve, reject) {
    var id = setTimeout(function () {
      clearTimeout(id);
      reject("Timed out in " + ms);
    }, ms);
  });

  return Promise.race([promise, timeout]);
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
    value: function progress(currentBytes, totalBytes) {
      this.emit("progress", {
        object: "unknown",
        totalBytes: totalBytes,
        currentBytes: currentBytes
      });
    }
  }, {
    key: "update",
    value: function () {
      var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(device, init, firmware, forceInit) {
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

                this.log("Device state " + device.state);

                if (!(device.state === "connected" || device.state === "error")) {
                  _context.next = 12;
                  break;
                }

                _context.next = 11;
                return new Promise(function (resolve) {
                  return device.disconnect(function () {
                    return resolve();
                  });
                });

              case 11:
                this.log("Disconnected");

              case 12:

                this.state(STATES.CONNECTING);
                disconnectWatcher = new Promise(function (resolve, reject) {
                  device.once("disconnect", function (error) {
                    _this2.controlChar = null;
                    _this2.packetChar = null;
                    _this2.log("Disconnect: " + error);
                    reject("disconnected");
                  });
                });
                _context.next = 16;
                return Promise.race([this.doUpdate(device, init, firmware, forceInit), disconnectWatcher]);

              case 16:
                return _context.abrupt("return", this.disconnect(device));

              case 17:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this);
      }));

      function update(_x, _x2, _x3, _x4) {
        return _ref.apply(this, arguments);
      }

      return update;
    }()
  }, {
    key: "doUpdate",
    value: function () {
      var _ref2 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2(device, init, firmware) {
        var forceInit = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                this.log("connecting to device");
                _context2.next = 3;
                return promiseTimeout(5000, this.connect(device));

              case 3:
                this.log("transferring init");
                this.state(STATES.STARTING);
                // await this.transferInit(init, 3)
                _context2.next = 7;
                return this.sendInitPacket(init, forceInit);

              case 7:
                this.log("transferring firmware");
                this.state(STATES.UPLOADING);
                // await this.transferFirmware(init, firmware, 3)
                _context2.next = 11;
                return this.sendFirmware(firmware);

              case 11:
                this.state(STATES.COMPLETED);

              case 12:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this);
      }));

      function doUpdate(_x5, _x6, _x7) {
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

      function connect(_x9) {
        return _ref3.apply(this, arguments);
      }

      return connect;
    }()
  }, {
    key: "gattConnect",
    value: function () {
      var _ref4 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee5(device) {
        var _this4 = this;

        var service;
        return regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                _context5.next = 2;
                return new Promise(function () {
                  var _ref5 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee4(resolve, reject) {
                    return regeneratorRuntime.wrap(function _callee4$(_context4) {
                      while (1) {
                        switch (_context4.prev = _context4.next) {
                          case 0:
                            device.connect(function (error) {
                              if (error) {
                                _this4.log("gattConnect: Error " + error);
                                return reject(error);
                              }
                              _this4.log(device);
                              resolve(device);
                            });

                          case 1:
                          case "end":
                            return _context4.stop();
                        }
                      }
                    }, _callee4, _this4);
                  }));

                  return function (_x11, _x12) {
                    return _ref5.apply(this, arguments);
                  };
                }());

              case 2:

                this.log("connected to gatt server");
                _context5.next = 5;
                return this.getDFUService(device).catch(function () {
                  _this4.log("Unable to find DFU service");
                  throw new Error("Unable to find DFU service");
                });

              case 5:
                service = _context5.sent;

                this.log("found DFU service");
                return _context5.abrupt("return", this.getDFUCharacteristics(service));

              case 8:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this);
      }));

      function gattConnect(_x10) {
        return _ref4.apply(this, arguments);
      }

      return gattConnect;
    }()
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
      var _this6 = this;

      return new Promise(function (resolve, reject) {
        _this6.log("getDfuService: Startin discover services");
        device.discoverServices([], function (error, services) {
          if (error) {
            _this6.log("getDfuService: Error " + error);
            return reject(error);
          }
          _this6.log("getDfuService: Found " + services.length + " services");
          for (var i = 0; i < services.length; i++) {
            if (services[i].uuid === SERVICE_UUID) {
              _this6.log("getDfuService: Success " + services[i]);
              resolve(services[i]);
            }
          }
          reject("DFU service not found");
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
      var _this7 = this;

      return this.gattConnect(device).then(function (characteristics) {
        _this7.log("found " + characteristics.length + " characteristic(s)");

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
        _this7.log("found buttonless characteristic");
        if (!buttonChar.properties.includes("notify") && !buttonChar.properties.includes("indicate")) {
          throw new Error("Buttonless characteristic does not allow notifications");
        }

        return new Promise(function (resolve, reject) {
          buttonChar.notify(true, function (error) {
            if (error) return reject(error);
            resolve();
          });
        }).then(function () {
          _this7.log("enabled buttonless notifications");
          buttonChar.on("data", _this7.handleNotification.bind(_this7));
          _this7.sendOperation(buttonChar, OPERATIONS.BUTTON_COMMAND);
        }).then(function () {
          _this7.log("sent dfu mode");
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
      var _this8 = this;

      return promiseTimeout(5000, new Promise(function (resolve, reject) {
        var size = operation.length;
        if (buffer) size += buffer.byteLength;

        var value = new Uint8Array(size);
        value.set(operation);
        if (buffer) {
          var data = new Uint8Array(buffer);
          value.set(data, operation.length);
        }

        _this8.notifyFns[operation[0]] = {
          resolve: resolve,
          reject: reject
        };

        writeCharacteristic(characteristic, new Buffer(value), false).catch(function (err) {
          return reject(err);
        });
      }));
    }
  }, {
    key: "sendInitPacket",
    value: function () {
      var _ref6 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee6(buffer) {
        var forceInit = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

        var initPacketSizeInBytes, response, maxSize, offset, crc, skipSendingInitPacket, resumeSendingInitPacket, transferred, attempt, view, data, _response, _crc, _transferred, responsedata;

        return regeneratorRuntime.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                this.bailOnAbort();
                initPacketSizeInBytes = buffer.byteLength;
                // First, select the Command Object. As a response the maximum command size and information whether there is already
                // a command saved from a previous connection is returned.

                this.log("requesting init state");
                _context6.next = 5;
                return this.sendControl(OPERATIONS.SELECT_COMMAND);

              case 5:
                response = _context6.sent;
                maxSize = response.getUint32(0, LITTLE_ENDIAN);
                offset = response.getUint32(4, LITTLE_ENDIAN);
                crc = response.getInt32(8, LITTLE_ENDIAN);

                this.log("received maxSize: " + maxSize + ", offset: " + offset + ", crc: " + crc);

                // Can we resume? If the offset obtained from the device is greater then zero we can compare it with the local init packet CRC
                // and resume sending the init packet, or even skip sending it if the whole file was sent before.
                skipSendingInitPacket = false;
                resumeSendingInitPacket = false;

                if (offset > 0 && offset <= initPacketSizeInBytes) {
                  this.log("offset is between 0 and buffer size (" + initPacketSizeInBytes + ")");
                  // Read the same number of bytes from the current init packet to calculate local CRC32
                  transferred = buffer.slice(0, offset);

                  this.log(transferred.byteLength);
                  // Calculate the CRC32
                  if (this.checkCrc(transferred, crc)) {
                    if (offset === initPacketSizeInBytes) {
                      this.log("The offset equals the init package size. Will skip sending init package");
                      // The whole init packet was sent and it is equal to one we try to send now.
                      // There is no need to send it again. We may try to resume sending data.
                      skipSendingInitPacket = true;
                    } else {
                      this.log("The offset is not equal to the init package size. Will resume sending init package");
                      resumeSendingInitPacket = true;
                    }
                  } else {
                    this.log("A different init package was sent before, or an error occurred while sending. Resending");
                    // A different Init packet was sent before, or the error occurred while sending.
                    // We have to send the whole Init packet again.
                    offset = 0;
                  }
                }

                if (forceInit) {
                  skipSendingInitPacket = false;
                  resumeSendingInitPacket = false;
                  offset = 0;
                  this.log("Forcing init transfer");
                }

                if (skipSendingInitPacket) {
                  _context6.next = 59;
                  break;
                }

                attempt = 1;

              case 16:
                if (!(attempt <= 3)) {
                  _context6.next = 57;
                  break;
                }

                if (resumeSendingInitPacket) {
                  _context6.next = 26;
                  break;
                }

                // Create the Init object
                // private static final int OP_CODE_CREATE_KEY = 0x01;
                // private static final int OBJECT_COMMAND = 0x01;
                this.log("creating init object");
                view = new DataView(new ArrayBuffer(4));

                view.setUint32(0, initPacketSizeInBytes, LITTLE_ENDIAN);
                _context6.next = 23;
                return this.sendControl(OPERATIONS.CREATE_COMMAND, view.buffer);

              case 23:
                this.log("creat command finished");
                _context6.next = 27;
                break;

              case 26:
                this.log("resuming sending init package: attempt " + attempt);

              case 27:
                // Write Init data to the Packet Characteristic
                data = buffer.slice(offset);

                this.log("transfering data starting with offset: " + offset);
                _context6.next = 31;
                return this.transferData(data, offset, 0);

              case 31:
                this.log("transferred data");

                // Calculate Checksum
                this.log("Calculating checksum");
                _context6.next = 35;
                return this.sendControl(OPERATIONS.CALCULATE_CHECKSUM);

              case 35:
                _response = _context6.sent;
                _crc = _response.getInt32(4, LITTLE_ENDIAN);
                _transferred = _response.getUint32(0, LITTLE_ENDIAN);
                responsedata = buffer.slice(0, _transferred);

                this.log("Received checksum: crc: " + _crc + ", transferred: " + _transferred);

                if (!this.checkCrc(responsedata, _crc)) {
                  _context6.next = 45;
                  break;
                }

                this.log("checksum ok");
                // Everything is OK, we can proceed
                return _context6.abrupt("break", 57);

              case 45:
                if (!(attempt < 3)) {
                  _context6.next = 52;
                  break;
                }

                this.log("Starting next attempt #" + attempt);
                attempt++;
                // Go back to the beginning, we will send the whole Init packet again
                resumeSendingInitPacket = false;
                offset = 0;
                _context6.next = 55;
                break;

              case 52:
                this.error("crc doesn't match");
                this.log("crc doesn't match");
                return _context6.abrupt("return", false);

              case 55:
                _context6.next = 16;
                break;

              case 57:
                _context6.next = 60;
                break;

              case 59:
                this.log("skipped sending init package");

              case 60:

                // Execute Init packet. It's better to execute it twice than not execute at all...
                this.log("executing");
                _context6.next = 63;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 63:
                this.log("finished executing");

                return _context6.abrupt("return", true);

              case 65:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this);
      }));

      function sendInitPacket(_x13) {
        return _ref6.apply(this, arguments);
      }

      return sendInitPacket;
    }()
  }, {
    key: "sendFirmware",
    value: function () {
      var _ref7 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee7(buffer) {
        var MAX_ATTEMPTS, response, maxSize, offset, crc, imageSizeInBytes, chunkCount, currentChunk, resumeSendingData, bytesSentAndExecuted, bytesSentNotExecuted, transferred, attempt, end, start, writeStart, view, data, _response2, _transferred2, bytesLost, responsedata;

        return regeneratorRuntime.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                MAX_ATTEMPTS = 3;

                this.bailOnAbort();
                // SELECT_DATA: [0x06, 0x02],
                this.log("requesting firmware state");
                _context7.next = 5;
                return this.sendControl(OPERATIONS.SELECT_DATA);

              case 5:
                response = _context7.sent;
                maxSize = response.getUint32(0, LITTLE_ENDIAN);
                offset = response.getUint32(4, LITTLE_ENDIAN);
                crc = response.getInt32(8, LITTLE_ENDIAN);

                this.log("received maxSize: " + maxSize + ", offset: " + offset + ", crc: " + crc);

                imageSizeInBytes = buffer.byteLength;

                // Number of chunks in which the data will be sent

                chunkCount = (imageSizeInBytes + maxSize - 1) / maxSize;
                currentChunk = 0;
                resumeSendingData = false;

                // Can we resume? If the offset obtained from the device is greater then zero we can compare it with the local CRC
                // and resume sending the data.

                if (!(offset > 0)) {
                  _context7.next = 34;
                  break;
                }

                currentChunk = Math.floor(offset / maxSize);
                bytesSentAndExecuted = maxSize * currentChunk;
                bytesSentNotExecuted = offset - bytesSentAndExecuted;


                this.log("bytesSentAndExecuted: " + bytesSentAndExecuted + ", bytesSentNotExecuted: " + bytesSentNotExecuted);

                // If the offset is dividable by maxSize, assume that the last page was not executed
                if (bytesSentNotExecuted === 0) {
                  bytesSentAndExecuted -= maxSize;
                  bytesSentNotExecuted = maxSize;
                }

                transferred = buffer.slice(0, offset);

                if (!this.checkCrc(transferred, crc)) {
                  _context7.next = 33;
                  break;
                }

                if (!(bytesSentNotExecuted === maxSize && offset < imageSizeInBytes)) {
                  _context7.next = 30;
                  break;
                }

                this.log("page was sent but not executed (crc match)");
                this.log("executing");
                _context7.next = 27;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 27:
                this.log("finished executing");
                _context7.next = 31;
                break;

              case 30:
                resumeSendingData = true;

              case 31:
                _context7.next = 34;
                break;

              case 33:
                // The CRC of the current object is not correct. If there was another Data object sent before, its CRC must have been correct,
                // as it has been executed. Either way, we have to create the current object again.
                offset -= bytesSentNotExecuted;

              case 34:
                if (!(offset < imageSizeInBytes)) {
                  _context7.next = 89;
                  break;
                }

                attempt = 1;
                end = 0;
                // Each page will be sent in MAX_ATTEMPTS

              case 37:
                this.log("starting attempt #" + attempt);
                start = offset - offset % maxSize;
                writeStart = offset;

                end = Math.min(start + maxSize, buffer.byteLength);

                if (resumeSendingData) {
                  _context7.next = 49;
                  break;
                }

                // Create the Data object
                view = new DataView(new ArrayBuffer(4));

                view.setUint32(0, end - start, LITTLE_ENDIAN);
                this.log("creating data object: size: " + (end - start));
                _context7.next = 47;
                return this.sendControl(OPERATIONS.CREATE_DATA, view.buffer);

              case 47:
                _context7.next = 50;
                break;

              case 49:
                resumeSendingData = false;

              case 50:
                data = buffer.slice(writeStart, end);

                this.log("transfering data starting with offset: " + offset);
                _context7.next = 54;
                return this.transferData(data, writeStart, 0, imageSizeInBytes);

              case 54:
                this.log("transferred data");

                // Calculate Checksum
                this.log("Calculating checksum");
                _context7.next = 58;
                return this.sendControl(OPERATIONS.CALCULATE_CHECKSUM);

              case 58:
                _response2 = _context7.sent;

                crc = _response2.getInt32(4, LITTLE_ENDIAN);
                _transferred2 = _response2.getUint32(0, LITTLE_ENDIAN);

                this.log("Received checksum: crc: " + crc + ", transferred: " + _transferred2);

                // It may happen, that not all bytes that were sent were received by the remote device
                bytesLost = end - _transferred2;

                this.log("Bytes lost: " + bytesLost);

                responsedata = buffer.slice(0, _transferred2);

                if (!this.checkCrc(responsedata, crc)) {
                  _context7.next = 78;
                  break;
                }

                if (!(bytesLost > 0)) {
                  _context7.next = 69;
                  break;
                }

                resumeSendingData = true;
                return _context7.abrupt("continue", 86);

              case 69:
                this.log("written " + _transferred2 + " bytes");
                _context7.next = 72;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 72:
                // Increment iterator
                currentChunk++;
                attempt = 1;
                offset = _transferred2;

                this.log("Next chunk: currentChunk: " + currentChunk + ", attempt: " + attempt + ", offset: " + offset);
                _context7.next = 86;
                break;

              case 78:
                if (!(attempt < MAX_ATTEMPTS)) {
                  _context7.next = 83;
                  break;
                }

                // try again with same offset
                this.log("Starting next attempt: " + attempt);
                attempt++;
                _context7.next = 86;
                break;

              case 83:
                this.error("crc doesn't match");
                this.log("crc doesn't match");
                return _context7.abrupt("return", false);

              case 86:
                if (end < buffer.byteLength) {
                  _context7.next = 37;
                  break;
                }

              case 87:
                _context7.next = 93;
                break;

              case 89:
                // Looks as if the whole file was sent correctly but has not been executed
                this.log("Executing");
                _context7.next = 92;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 92:
                this.log("Finished executing");

              case 93:
                return _context7.abrupt("return", true);

              case 94:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this);
      }));

      function sendFirmware(_x15) {
        return _ref7.apply(this, arguments);
      }

      return sendFirmware;
    }()
  }, {
    key: "transferData",
    value: function () {
      var _ref8 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee8(data, offset, start) {
        var wholeSize = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
        var end, packet, buffer;
        return regeneratorRuntime.wrap(function _callee8$(_context8) {
          while (1) {
            switch (_context8.prev = _context8.next) {
              case 0:
                start = start || 0;
                end = Math.min(start + PACKET_SIZE, data.byteLength);
                packet = data.slice(start, end);
                buffer = new Buffer(packet);


                if (start === 4080) {
                  this.log("Writing from " + start + " to " + end);
                }
                _context8.next = 7;
                return promiseTimeout(5000, writeCharacteristic(this.packetChar, buffer));

              case 7:
                if (start === 4080) {
                  this.log("Finished writing");
                }
                if (wholeSize) {
                  this.progress(offset + start + PACKET_SIZE, wholeSize);
                }

                if (!(end < data.byteLength)) {
                  _context8.next = 11;
                  break;
                }

                return _context8.abrupt("return", this.transferData(data, offset, end, wholeSize));

              case 11:
              case "end":
                return _context8.stop();
            }
          }
        }, _callee8, this);
      }));

      function transferData(_x16, _x17, _x18) {
        return _ref8.apply(this, arguments);
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

      var ourCrc = this.crc32(new Uint8Array(buffer));
      this.log("Our calculated crc: " + ourCrc + ", received: " + crc);
      return crc === ourCrc;
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
var isLinux = /^linux/.test(process.platform);

var defaultWithoutResponse = !isWindows && !isLinux;

function writeCharacteristic(characteristic, buffer) {
  var withoutResponse = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : defaultWithoutResponse;

  return new Promise(function (resolve, reject) {
    characteristic.write(buffer, withoutResponse, function (error) {
      if (error) return reject(error);
      resolve();
    });
  });
}