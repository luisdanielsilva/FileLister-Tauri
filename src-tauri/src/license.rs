// Mirrors LicenseManager.validate in the Swift app exactly:
// key = 6 groups of 4 [A-Z0-9], seed = first 5 groups joined, signature = group 6.
// Expected signature = first 4 hex chars (uppercase) of SHA256(seed + salt).
use sha2::{Digest, Sha256};

const SALT: &str = "FileLister-Secret-Salt-2026-Porto";

pub fn validate(key: &str) -> bool {
    let key = key.to_uppercase();
    let parts: Vec<&str> = key.split('-').collect();
    if parts.len() != 6 {
        return false;
    }
    for p in &parts {
        if p.len() != 4 || !p.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
            return false;
        }
    }
    let seed: String = parts[0..5].concat();
    let provided = parts[5];

    let mut hasher = Sha256::new();
    hasher.update(format!("{seed}{SALT}").as_bytes());
    let digest = hasher.finalize();
    let expected: String = digest.iter().map(|b| format!("{:02X}", b)).collect::<String>()[..4].to_string();

    provided == expected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_correctly_signed_key() {
        // Signature computed from SHA256(seed + salt), matching the Swift algorithm.
        assert!(validate("A1B2-C3D4-E5F6-G7H8-J9K0-D852"));
        assert!(validate("a1b2-c3d4-e5f6-g7h8-j9k0-d852")); // case-insensitive
    }

    #[test]
    fn rejects_bad_signature_and_format() {
        assert!(!validate("A1B2-C3D4-E5F6-G7H8-J9K0-XXXX"));
        assert!(!validate("A1B2-C3D4-E5F6-G7H8-J9K0")); // too few groups
        assert!(!validate("not-a-key"));
        assert!(!validate("A1B2-C3D4-E5F6-G7H8-J9K0-D85")); // wrong length group
    }
}
