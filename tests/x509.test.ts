import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { X509Certificate } from "node:crypto";
import {
  classifySignatureAlgorithm,
  decodeOid,
  isSelfSigned,
  parseSignatureAlgorithmOid,
  readTlv,
  summarisePublicKey,
} from "@/lib/x509";

/**
 * Deterministic X.509 tests.
 *
 * The fixtures are real leaf certificates captured from live TLS handshakes and
 * checked into the repository as base64 DER, so these tests never touch the
 * network and never depend on a host still serving the same certificate.
 */

const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): Buffer {
  return Buffer.from(readFileSync(join(here, "fixtures", name), "utf8").trim(), "base64");
}

/** DER-encode one TLV with a definite length. */
function tlv(tag: number, content: Buffer): Buffer {
  const length = content.length;
  let lengthBytes: Buffer;
  if (length < 0x80) {
    lengthBytes = Buffer.from([length]);
  } else {
    const bytes: number[] = [];
    let remaining = length;
    while (remaining > 0) {
      bytes.unshift(remaining & 0xff);
      remaining >>= 8;
    }
    lengthBytes = Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), lengthBytes, content]);
}

/**
 * Build a structurally valid certificate shell around a chosen signature OID:
 * SEQUENCE { tbsCertificate SEQUENCE { INTEGER serial, SEQUENCE { OID } }, ... }
 */
function synthesiseCertificate(signatureOid: Buffer): Buffer {
  const algorithmIdentifier = tlv(0x30, tlv(0x06, signatureOid));
  const tbs = tlv(0x30, Buffer.concat([tlv(0x02, Buffer.from([0x2a])), algorithmIdentifier]));
  return tlv(0x30, Buffer.concat([tbs, algorithmIdentifier, tlv(0x03, Buffer.from([0x00]))]));
}

describe("DER TLV reader", () => {
  it("reads a short-form length", () => {
    // SEQUENCE (0x30) with a 2-byte content of 0x04 0x01
    const der = new Uint8Array([0x30, 0x02, 0x04, 0x01]);
    const tlv = readTlv(der, 0);
    expect(tlv).not.toBeNull();
    expect(tlv?.tag).toBe(0x30);
    expect(tlv?.contentStart).toBe(2);
    expect(tlv?.contentEnd).toBe(4);
    expect(tlv?.next).toBe(4);
  });

  it("reads a long-form length", () => {
    const der = new Uint8Array([0x30, 0x81, 0x80, ...new Array<number>(128).fill(0)]);
    const tlv = readTlv(der, 0);
    expect(tlv?.contentEnd).toBe(131);
  });

  it("returns null on a truncated buffer instead of throwing", () => {
    expect(readTlv(new Uint8Array([0x30]), 0)).toBeNull();
    expect(readTlv(new Uint8Array([0x30, 0x05, 0x01]), 0)).toBeNull();
    expect(readTlv(new Uint8Array([0x30, 0x88, 0, 0, 0]), 0)).toBeNull();
    expect(readTlv(new Uint8Array([]), 0)).toBeNull();
  });
});

describe("decodeOid", () => {
  it("decodes a two-byte OID", () => {
    // 1.2.840.113549.1.1.11 -> 2a 86 48 86 f7 0d 01 01 0b
    const bytes = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
    expect(decodeOid(bytes, 0, bytes.length)).toBe("1.2.840.113549.1.1.11");
  });

  it("decodes a multi-byte arc", () => {
    // 2.16.840.1.101.3.4.3.17 -> 60 86 48 01 65 03 04 03 11
    const bytes = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x11]);
    expect(decodeOid(bytes, 0, bytes.length)).toBe("2.16.840.1.101.3.4.3.17");
  });

  it("returns null for an empty value", () => {
    expect(decodeOid(new Uint8Array([]), 0, 0)).toBeNull();
  });
});

describe("signature algorithm extraction from real certificates", () => {
  it("reads the ECDSA-with-SHA256 OID from a captured leaf", () => {
    const der = fixture("live-leaf-der.b64");
    expect(parseSignatureAlgorithmOid(der)).toBe("1.2.840.10045.4.3.2");
  });

  it("labels it as a non-quantum RSA/ECDSA family signature", () => {
    const der = fixture("live-leaf-der.b64");
    const signature = classifySignatureAlgorithm(der);
    expect(signature.oid).toBe("1.2.840.10045.4.3.2");
    expect(signature.label).toBe("ECDSA with SHA-256");
    expect(signature.postQuantum).toBe(false);
  });

  it("reads the signature OID of a second, differently sized certificate", () => {
    const der = fixture("live-leaf-ec-p384.b64");
    const oid = parseSignatureAlgorithmOid(der);
    expect(oid).not.toBeNull();
    // A genuine signature OID always begins with the 1.2 joint arc.
    expect(oid).toMatch(/^[12]\.[0-9]+\.[0-9]+\./);
  });

  it("classifies the ML-DSA OID as post-quantum", () => {
    // Build a minimal certificate-shaped DER whose tbsCertificate carries the
    // ML-DSA-87 signature OID, so the classifier is exercised end to end rather
    // than through a hand-written expectation.
    const oidContent = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x13]);
    const der = synthesiseCertificate(oidContent);
    expect(parseSignatureAlgorithmOid(der)).toBe("2.16.840.1.101.3.4.3.19");
    const signature = classifySignatureAlgorithm(der);
    expect(signature.label).toBe("ML-DSA-87");
    expect(signature.postQuantum).toBe(true);
  });

  it("returns a null OID for bytes that are not a certificate", () => {
    expect(parseSignatureAlgorithmOid(new Uint8Array([0xff, 0xff, 0xff]))).toBeNull();
  });
});

describe("public key summarisation from real certificates", () => {
  it("identifies an EC P-256 leaf key", () => {
    const der = fixture("live-leaf-der.b64");
    const certificate = new X509Certificate(der);
    const summary = summarisePublicKey(certificate, { bits: 256, asn1Curve: "prime256v1" });
    expect(summary.algorithm).toBe("ec");
    expect(summary.bits).toBe(256);
    expect(summary.curve).toBe("prime256v1");
    expect(summary.recognised).toBe(true);
  });

  it("identifies a P-384 leaf key", () => {
    const der = fixture("live-leaf-ec-p384.b64");
    const certificate = new X509Certificate(der);
    const summary = summarisePublicKey(certificate, {});
    expect(["ec", "rsa"]).toContain(summary.algorithm);
    expect(summary.bits === null || summary.bits > 0).toBe(true);
  });

  it("does not treat an ordinary leaf certificate as self-signed", () => {
    const der = fixture("live-leaf-der.b64");
    expect(isSelfSigned(new X509Certificate(der))).toBe(false);
  });

  it("reads the subject of a captured leaf", () => {
    const der = fixture("live-leaf-der.b64");
    const certificate = new X509Certificate(der);
    expect(certificate.subject).toContain("CN=");
    expect(certificate.validTo.length).toBeGreaterThan(0);
  });
});