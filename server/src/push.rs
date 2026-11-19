//! Web Push (VAPID). Keys are generated on first start and stored next to the database.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openssl::{
    bn::BigNumContext,
    ec::{EcGroup, EcKey, PointConversionForm},
    nid::Nid,
};
use std::time::Duration;
use web_push::{ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient, WebPushError, WebPushMessageBuilder};

const PUSH_SEND_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Push {
    pem: Vec<u8>,
    pub public_key: String,
    subject: String,
    client: HyperWebPushClient,
}

pub enum SendResult {
    Ok,
    /// subscription is gone (404/410) — delete it
    Gone,
    Failed(String),
}

fn tighten_key_permissions(path: &str) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

fn write_private_key(path: &str, pem: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
        f.write_all(pem)?;
        tighten_key_permissions(path);
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, pem)
    }
}

impl Push {
    pub fn load_or_create(path: &str, subject: String) -> anyhow::Result<Push> {
        let pem = match std::fs::read(path) {
            Ok(p) => {
                tighten_key_permissions(path);
                p
            }
            Err(_) => {
                let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1)?;
                let key = EcKey::generate(&group)?;
                let pem = key.private_key_to_pem()?;
                write_private_key(path, &pem)?;
                tracing::info!("generated new VAPID key at {path}");
                pem
            }
        };
        let key = EcKey::private_key_from_pem(&pem)?;
        let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1)?;
        let mut ctx = BigNumContext::new()?;
        let bytes = key.public_key().to_bytes(&group, PointConversionForm::UNCOMPRESSED, &mut ctx)?;
        Ok(Push { pem, public_key: URL_SAFE_NO_PAD.encode(bytes), subject, client: HyperWebPushClient::new() })
    }

    pub async fn send(&self, endpoint: &str, p256dh: &str, auth: &str, payload: &serde_json::Value) -> SendResult {
        let sub = SubscriptionInfo::new(endpoint, p256dh, auth);
        let mut sig = match VapidSignatureBuilder::from_pem(&self.pem[..], &sub) {
            Ok(s) => s,
            Err(e) => return SendResult::Failed(e.to_string()),
        };
        sig.add_claim("sub", self.subject.as_str());
        let sig = match sig.build() {
            Ok(s) => s,
            Err(e) => return SendResult::Failed(e.to_string()),
        };
        let body = payload.to_string();
        let mut b = WebPushMessageBuilder::new(&sub);
        b.set_payload(ContentEncoding::Aes128Gcm, body.as_bytes());
        b.set_vapid_signature(sig);
        b.set_ttl(12 * 3600);
        let msg = match b.build() {
            Ok(m) => m,
            Err(e) => return SendResult::Failed(e.to_string()),
        };
        match tokio::time::timeout(PUSH_SEND_TIMEOUT, self.client.send(msg)).await {
            Ok(Ok(())) => SendResult::Ok,
            Ok(Err(WebPushError::EndpointNotValid)) | Ok(Err(WebPushError::EndpointNotFound)) => SendResult::Gone,
            Ok(Err(e)) => SendResult::Failed(e.to_string()),
            Err(_) => SendResult::Failed("push delivery timed out".to_string()),
        }
    }
}
