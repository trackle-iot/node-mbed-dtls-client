
#include "DtlsSocket.h"
#include "SessionWrap.h"

NAN_MODULE_INIT(init) {
	DtlsSocket::Initialize(target);
	SessionWrap::Initialize(target);
}

NODE_MODULE(node_mbed_dtls_client, init);
