const xmpp_config = {
    server: {
        ip: '0.0.0.0',
        port: '5222'
    },
    options: {
        muc_name: 'muc',
        show_version_in_status: false
    },
    certs: {
        key: 'cfg/certificate/private.key',
        cert: 'cfg/certificate/certificate.crt',
        ca_bundle: 'cfg/certificate/ca_bundle.crt'
    },
    log_debug: true
}

export default xmpp_config;