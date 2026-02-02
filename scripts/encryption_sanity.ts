
import { encryptToken, decryptToken } from "../src/server/db/encryption";
import { createScopedLogger } from "../src/server/lib/logger";
import { env } from "../src/env";

const logger = createScopedLogger("sanity-check");

async function main() {
    console.log("🔒 Starting Encryption Sanity Check...");

    // Verify Environment
    if (!env.EMAIL_ENCRYPT_SECRET || !env.EMAIL_ENCRYPT_SALT) {
        console.error("❌ Missing Encryption Environment Variables!");
        process.exit(1);
    } else {
        console.log("✅ Encryption Environment Variables Verified.");
    }

    // Encryption Test
    const testString = "sanity-check-token-12345";
    console.log(`\n🔑 Testing Encryption for: "${testString}"`);

    const encrypted = encryptToken(testString);
    if (!encrypted) {
        console.error("❌ Encryption Failed (Result is null)");
        process.exit(1);
    }
    console.log(`✅ Encrypted: ${encrypted}`);

    // Decryption Test
    const decrypted = decryptToken(encrypted);
    if (!decrypted) {
        console.error("❌ Decryption Failed (Result is null)");
        process.exit(1);
    }

    if (decrypted !== testString) {
        console.error(`❌ Mismatch! Decrypted: "${decrypted}" !== Original: "${testString}"`);
        process.exit(1);
    }
    console.log(`✅ Decrypted: ${decrypted}`);
    console.log("🎉 Encryption Logic Verified Successfully!");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
