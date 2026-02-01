# ⚠️ This is NOT a backend ⚠️
This is a standalone TCP server that you can run alongside a backend such as [LawinServer](https://github.com/Lawin0129/LawinServerV2) if configured correctly. It's currently not 100% finished but it's in a mostly usuable state.

## What does it do?
TCP functions similarly to how it does in [TCP-Backend](https://github.com/Sub2Rhys/TCP-Backend), except OpenFire is no longer required and the setup is much easier.

## Issues
Some of this code is AI, it has a few bugs but it works mostly. The only bug I encountered was the party chat not working when rejoining a previously left party.

# The following instructions are modified from [here](https://github.com/Sub2Rhys/TCP-Backend)

## Requirements
- [Knowledge on port forwarding](https://www.noip.com/support/knowledgebase/general-port-forwarding-guide) (So users can access the server)
- [Node.js that supports TLS 1](nodejs.org/dist/v16.20.2/node-v16.20.2-x64.msi) (I use Node.js v16.20.2, below this should also work)
- [Domain](https://www.123-reg.co.uk/) (I use 123-Reg for mine, but there's other options out there)
- [SSL certificates](https://zerossl.com/) (Must be trusted by Fortnite for it to work, use ZeroSSL)

## SSL Certificates
### Do NOT use a wildcard certificate, I've been told they won't work with this and ZeroSSL charges to get them. Also don't tick any extra boxes in the ZeroSSL setup as it will likely try charging you.

You will need your own domain for this, I won't be covering how to get one in this guide but it's easy to find one and often you can get them for insanely cheap. I got mine from [123-Reg](https://www.123-reg.co.uk/) and recommend it if you're cheap like me.

After obtaining a domain, go to [ZeroSSL](https://zerossl.com/) and request a certificate for a subdomain. Follow the steps to verify you own the domain and then you will be granted the certificates. You'll end up with three files called `ca_bundle.crt`, `certificate.crt` and `private.key`. You'll need these for later when we setup the server.

To avoid confusion, I will be using `test.rhysbot.com` throughout this guide, so every time you see my domain, just replace it with yours (e.g. `xmpp.example.com`).

## Cloudflare
This part is simple, just login to [Cloudflare](https://dash.cloudflare.com/) and register your domain.

After verifying your domain, go to the DNS tab and copy what I've done in the image below, replace the IP with your public IP or an IP that is publicly accessible. If you don't know your IP then you can google it.

<img width="1262" height="421" alt="28b32fe0-52a1-49d8-98f6-e3dc5d3c11b4" src="https://github.com/user-attachments/assets/16ce7970-2342-4f98-be29-63f9ef2f797c" />

For TCP to work correctly, you need to open some ports.

- The server needs - 5222, 9090.

Chances are I may have missed a port, if I have then let me know.

## Configuring The Backend
### Due to how live friend requests work, they're done via rest requests that you have to call from your backend.

You need to modify `DefaultEngine.ini` in your backend. Just change `Domain` and `ServerAddr` to be your domain.

<img width="238" height="112" alt="426faa02-9288-4bce-8a55-cb249dac0dc1" src="https://github.com/user-attachments/assets/ab96cdba-6550-4361-b664-a601c0e15cf1" />

---

## Still saying you're offline?
It might be a client issue. If using something like Fiddler, make sure your settings are like this. Make sure to press `Trust Root Certificate`.

<img width="710" height="381" alt="image" src="https://github.com/user-attachments/assets/df7a7c61-be66-4b28-836c-23f45bae1811" />

```csharp
import System;
import System.Web;
import System.Windows.Forms;
import Fiddler;

class Handlers
{ 
    static function OnBeforeRequest(oSession: Session) {
        if (oSession.hostname.Contains(".ol.epicgames.com")) {
            if (oSession.HTTPMethodIs("CONNECT"))
            {
                oSession["x-replywithtunnel"] = "FortniteTunnel";
                return;
            }
            oSession.fullUrl = "http://127.0.0.1:8080" + oSession.PathAndQuery;
        }
    }
}
```



