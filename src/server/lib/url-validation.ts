/**
 * URL Validation Utility for SSRF Protection
 * 
 * This module provides safe URL validation to prevent Server-Side Request Forgery (SSRF) attacks.
 * It blocks requests to:
 * - Private IP ranges (RFC1918)
 * - Loopback addresses (localhost, 127.x.x.x, ::1)
 * - Link-local addresses (169.254.x.x, fe80::)
 * - Cloud metadata endpoints (169.254.169.254)
 * - Non-HTTP protocols
 * 
 * Based on OWASP SSRF Prevention guidelines:
 * https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs
 */

import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("url-validation");

/**
 * Check if a hostname is an IP address (v4 or v6)
 */
function isIpAddress(hostname: string): boolean {
    // IPv4 pattern: x.x.x.x
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 pattern (simplified): contains colons and possibly brackets
    const ipv6Regex = /^(\[)?[a-fA-F0-9:]+(\])?$/;
    
    return ipv4Regex.test(hostname) || ipv6Regex.test(hostname);
}

/**
 * Parse an IPv4 address into its octets
 */
function parseIpv4(ip: string): number[] | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    
    const octets = parts.map(p => parseInt(p, 10));
    if (octets.some(o => isNaN(o) || o < 0 || o > 255)) return null;
    
    return octets;
}

/**
 * Check if an IPv4 address is in a private/dangerous range
 */
function isPrivateIpv4(ip: string): boolean {
    const octets = parseIpv4(ip);
    if (!octets) return false;
    
    const [a, b, c, d] = octets;
    
    // Loopback: 127.0.0.0/8
    if (a === 127) return true;
    
    // Private networks: RFC1918
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    
    // Link-local: 169.254.0.0/16 (includes AWS metadata at 169.254.169.254)
    if (a === 169 && b === 254) return true;
    
    // Broadcast: 255.255.255.255
    if (a === 255 && b === 255 && c === 255 && d === 255) return true;
    
    // Current network: 0.0.0.0/8
    if (a === 0) return true;
    
    return false;
}

/**
 * Check if an IPv6 address is loopback or link-local
 */
function isPrivateIpv6(ip: string): boolean {
    // Remove brackets if present
    const cleanIp = ip.replace(/^\[|\]$/g, '').toLowerCase();
    
    // Loopback ::1
    if (cleanIp === '::1' || cleanIp === '0:0:0:0:0:0:0:1') return true;
    
    // Link-local fe80::/10
    if (cleanIp.startsWith('fe80:') || cleanIp.startsWith('fe80::')) return true;
    
    // IPv4-mapped IPv6 addresses ::ffff:x.x.x.x
    const ipv4MappedMatch = cleanIp.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (ipv4MappedMatch) {
        return isPrivateIpv4(ipv4MappedMatch[1]);
    }
    
    // Unique local addresses fc00::/7 (fd00::/8 commonly used)
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true;
    
    return false;
}

/**
 * List of dangerous hostnames that should be blocked
 */
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    // Cloud provider metadata endpoints
    'metadata.google.internal',
    'metadata.gce.internal',
    'instance-data',
    // Common internal hostnames
    'internal',
    'local',
]);

/**
 * Result of URL validation
 */
export interface UrlValidationResult {
    safe: boolean;
    reason?: string;
}

/**
 * Validate a URL for SSRF safety
 * 
 * @param urlString - The URL to validate
 * @returns Object with `safe` boolean and optional `reason` for rejection
 */
export function validateUrlForSsrf(urlString: string): UrlValidationResult {
    try {
        // 1. Parse the URL using WHATWG URL API for consistent handling
        const url = new URL(urlString);
        
        // 2. Validate protocol (only allow http and https)
        if (!['http:', 'https:'].includes(url.protocol)) {
            return { safe: false, reason: `Protocol '${url.protocol}' is not allowed. Only http and https are permitted.` };
        }
        
        // 3. Block URLs with credentials (user:pass@host)
        if (url.username || url.password) {
            return { safe: false, reason: 'URLs with embedded credentials are not allowed.' };
        }
        
        // 4. Normalize and check hostname
        const hostname = url.hostname.toLowerCase();
        
        // 5. Check against blocked hostnames
        if (BLOCKED_HOSTNAMES.has(hostname)) {
            return { safe: false, reason: `Hostname '${hostname}' is blocked.` };
        }
        
        // 6. Check if it's an IP address
        if (isIpAddress(hostname)) {
            // Check IPv4
            if (parseIpv4(hostname) && isPrivateIpv4(hostname)) {
                return { safe: false, reason: `IP address '${hostname}' is in a private/reserved range.` };
            }
            // Check IPv6
            if (isPrivateIpv6(hostname)) {
                return { safe: false, reason: `IPv6 address '${hostname}' is loopback or link-local.` };
            }
        }
        
        // 7. Additional checks for encoded IPs (decimal, hex, octal)
        // Example: 2130706433 = 127.0.0.1, 0x7f000001 = 127.0.0.1
        const numericMatch = hostname.match(/^(\d+)$/);
        if (numericMatch) {
            const num = parseInt(numericMatch[1], 10);
            // Convert decimal to IPv4
            const a = (num >> 24) & 0xff;
            const b = (num >> 16) & 0xff;
            const c = (num >> 8) & 0xff;
            const d = num & 0xff;
            const reconstructedIp = `${a}.${b}.${c}.${d}`;
            if (isPrivateIpv4(reconstructedIp)) {
                return { safe: false, reason: `Encoded IP '${hostname}' resolves to private address '${reconstructedIp}'.` };
            }
        }
        
        // URL passed all checks
        return { safe: true };
        
    } catch (error) {
        // URL parsing failed
        return { safe: false, reason: 'Invalid URL format.' };
    }
}

/**
 * Check if a URL is safe for server-side requests
 * 
 * @param urlString - The URL to check
 * @returns true if the URL is safe to fetch, false otherwise
 */
export function isUrlSafeForServerRequest(urlString: string): boolean {
    const result = validateUrlForSsrf(urlString);
    
    if (!result.safe) {
        logger.warn("Blocked unsafe URL", { url: urlString, reason: result.reason });
    }
    
    return result.safe;
}
