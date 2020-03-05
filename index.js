'use strict';

const DtlsSocket = require('./socket');

function connect(options, secureConnectListener) {
	const socket = new DtlsSocket(options);
	if (secureConnectListener) {
		socket.once('secureConnect', secureConnectListener);
	}

	return socket;
}

module.exports = { connect };
