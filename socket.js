'use strict';

const stream = require('stream');
const dgram = require('dgram');
const fs = require('fs');

const mbed = require('bindings')('node_mbed_dtls_client.node');

const MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY = -0x7880;

class DtlsSocket extends stream.Duplex {
	constructor(options) {
		super({ allowHalfOpen: false });
		options = options || {};

		this.remoteAddress = options.host;
		this.remotePort = options.port;
		this.dgramSocket = options.socket || dgram.createSocket('udp4');

		this._onMessage = this._onMessage.bind(this);
		this.dgramSocket.on('message', this._onMessage);
		this.dgramSocket.once('error', err => {
			this.emit('error', err);
			this._end();
		});
		this.dgramSocket.once('close', () => {
			this._socketClosed();
		});

		const privateKey = Buffer.isBuffer(options.key) ? options.key : fs.readFileSync(options.key);
		const peerPublicKey = Buffer.isBuffer(options.peerPublicKey) ? options.peerPublicKey : fs.readFileSync(options.peerPublicKey);

		this.mbedSocket = new mbed.DtlsSocket(privateKey, peerPublicKey,
			this._sendEncrypted.bind(this),
			this._handshakeComplete.bind(this),
			this._error.bind(this),
			options.debug);

		process.nextTick(() => {
			this.mbedSocket.connect();
		});
	}

	get outCounter() {
		return this.mbedSocket.outCounter;
	}

	get session() {
		return this.mbedSocket.session;
	}

	dumbPing() {
		this.dgramSocket.send(Buffer.from([0x70]), 0, 1, this.remotePort, this.remoteAddress);
	}

	bind(port, address, callback) {
		this.dgramSocket.bind(port, address, callback);
	}

	address() {
		return this.dgramSocket.address();
	}

	_onMessage(msg) {
		if (!this.mbedSocket) {
			return;
		}

		const data = this.mbedSocket.receiveData(msg);
		if (data) {
			this.push(data);
		}
	}

	_read() {
		// do nothing!
	}

	_write(chunk, encoding, callback) {
		this._sendCallback = callback;
		this.mbedSocket.send(chunk);
	}

	_sendEncrypted(msg) {
		// store the callback here because '_write' might be called
		// again before the underlying socket finishes sending
		const sendCb = this._sendCallback;
		this._sendCallback = null;
		const sendFinished = (err) => {
			if (sendCb) {
				sendCb(err);
			}
			if (this._sendNotify) {
				this._closeSocket();
			}
		};

		if (!this.dgramSocket) {
			process.nextTick(() => {
				sendFinished(new Error('no underlying socket'));
			});
			return;
		}

		this.dgramSocket.send(msg, 0, msg.length, this.remotePort, this.remoteAddress, sendFinished);
	}

	_handshakeComplete() {
		this.connected = true;
		this.emit('secureConnect', this);
	}

	_error(code, msg) {
		if (code === MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) {
			this._end();
			return;
		}

		this._hadError = true;
		if (this._sendCallback) {
			this._sendCallback(code);
			this._sendCallback = null;
		} else {
			this.emit('err', code, msg);
		}
		this._end();
	}

	end() {
		this._sendNotify = true;
		this._end();
	}

	_end() {
		if (this._ending) {
			return;
		}
		this._ending = true;

		if (this.dgramSocket) {
			this.dgramSocket.removeListener('message', this._onMessage);
		}

		super.end();
		this.push(null);

		const noSend = this.mbedSocket.close();
		this.mbedSocket = null;

		if (noSend || !this._sendNotify) {
			this._closeSocket();
		}
	}

	_closeSocket() {
		if (!this.dgramSocket) {
			this._socketClosed();
			return;
		}

		this.dgramSocket.close();
	}

	_socketClosed() {
		this.dgramSocket = null;
		this.emit('close', this._hadError);
		this.removeAllListeners();
	}
}

module.exports = DtlsSocket;
