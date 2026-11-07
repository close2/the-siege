//! Web Push (VAPID). Keys are generated on first start and stored next to the database.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use openssl::{
    bn::BigNumContext,
    ec::{EcGroup, EcKey, PointConversionForm},
    nid::Nid,
};
use web_push::{ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient, WebPushError, WebPushMessageBuilder};

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

impl Push {
    pub fn load_or_create(path: &str, subject: String) -> anyhow::Result<Push> {
        let pem = match std::fs::read(path) {
            Ok(p) => p,
            Err(_) => {
                let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1)?;
                let key = EcKey::generate(&group)?;
                let pem = key.private_key_to_pem()?;
                std::fs::write(path, &pem)?;
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
        match self.client.send(msg).await {
            Ok(()) => SendResult::Ok,
            Err(WebPushError::EndpointNotValid) | Err(WebPushError::EndpointNotFound) => SendResult::Gone,
            Err(e) => SendResult::Failed(e.to_string()),
        }
    }
}
