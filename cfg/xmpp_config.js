// feel free to add more options if you need, just try and keep them organised into their own sections.

const xmpp_config = {
    server: {
        ip: '0.0.0.0',
        port: '5222'
    },
    host: {
        domain: 'xmpp-service.project-zero.cloud'
    },
    options: {
        muc_name: 'muc',
        global_chat_name: 'globalchatzero'
    },
    certs: {
        key: 'cfg/certificate/private.key',
        cert: 'cfg/certificate/certificate.crt',
        ca_bundle: 'cfg/certificate/ca_bundle.crt'
    },
    log_debug: true
}

export default xmpp_config;