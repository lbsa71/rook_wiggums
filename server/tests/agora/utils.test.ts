import {
  buildPeerReferenceDirectory,
  compactKnownInlineReferences,
  resolvePeerReference,
  shortKey,
} from "../../src/agora/utils";

describe("Agora utils", () => {
  describe("shortKey", () => {
    it("should return last 8 characters of a public key", () => {
      const publicKey = "302a300506032b6570032100abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      expect(shortKey(publicKey)).toBe("@cdefabcd");
    });

    it("should handle different key endings", () => {
      const key1 = "302a300506032b65700321001234567890abcdef1234567890abcdef1234567890abcdef1234567890ab1b69";
      const key2 = "302a300506032b65700321009876543210fedcba9876543210fedcba9876543210fedcba9876543210fef6d0";
      const key3 = "302a300506032b6570032100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3eb4";
      
      expect(shortKey(key1)).toBe("@90ab1b69");
      expect(shortKey(key2)).toBe("@10fef6d0");
      expect(shortKey(key3)).toBe("@aaaa3eb4");
    });

    it("should work with short keys", () => {
      expect(shortKey("12345678")).toBe("@12345678");
      expect(shortKey("abc")).toBe("@abc");
    });

    it("should work with empty string", () => {
      expect(shortKey("")).toBe("@");
    });
  });

  describe("peer reference helpers", () => {
    const mockService = {
      getPeers: () => ["rook", "bishop"],
      getSelfIdentity: () => ({
        publicKey: "302a300506032b6570032100selfselfselfselfselfselfselfselfselfselfselfself00000000",
        name: "nova",
      }),
      getPeerConfig: (ref: string) => {
        if (ref === "rook") {
          return {
            publicKey: "302a300506032b6570032100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            name: "rook",
          };
        }
        if (ref === "bishop") {
          return {
            publicKey: "302a300506032b6570032100bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            name: "bishop",
          };
        }
        return undefined;
      },
    };

    it("builds a peer directory keyed by public key", () => {
      const directory = buildPeerReferenceDirectory(mockService as never);
      expect(Object.keys(directory)).toHaveLength(3); // rook + bishop + self
      expect(directory["302a300506032b6570032100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"].name).toBe("rook");
    });

    it("expands compact peer refs when resolvable", () => {
      const directory = buildPeerReferenceDirectory(mockService as never);
      expect(resolvePeerReference("rook", directory)).toBe("302a300506032b6570032100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(resolvePeerReference("...bbbbbbbb", directory)).toBe("302a300506032b6570032100bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    });

    it("keeps unresolved refs unchanged", () => {
      const directory = buildPeerReferenceDirectory(mockService as never);
      expect(resolvePeerReference("unknown-peer", directory)).toBe("unknown-peer");
    });

    it("compacts inline @refs only for IDs present in config", () => {
      const directory = buildPeerReferenceDirectory(mockService as never);
      const text = "ping @302a300506032b6570032100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and @302a300506032b6570032100cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
      const compacted = compactKnownInlineReferences(text, directory);

      expect(compacted).toContain("@rook@aaaaaaaa");
      expect(compacted).toContain("@302a300506032b6570032100cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    });
  });
});
