const rest_config = {
    host: {
        ip: '0.0.0.0',
        port: '9000'
    },
    certs: {
        key: 'cfg/certificate/private.key',
        cert: 'cfg/certificate/certificate.crt',
        ca_bundle: 'cfg/certificate/ca_bundle.crt'
    }
}

export default rest_config;