/**
 * test.ts
 *
 * TypeScript version of the original test.js.
 * - Reads a compiled sproto bundle (protocol.spb)
 * - Creates sproto instance and demonstrates host/attach/dispatch usage
 *
 * Notes:
 * - We convert Node Buffer -> number[] (ByteArray) via Array.from(buffer) so it matches sproto's expected byte array shape.
 * - This file is intended to be executed directly with Bun (recommended) or with Node after compiling.
 */

import fs from "fs";
import sproto from './src/sproto/sproto.js';

const filename = "./examples/sproto.spb";

try {
  const raw = fs.readFileSync(filename);
  if (!raw || raw.length === 0) {
    console.error("read file error:", filename);
    process.exit(1);
  }

  // convert Node Buffer -> number[] (ByteArray)
  const bundle: number[] = Array.from(raw);

  // create sproto instance from bundle
  const sp = sproto.createNew(bundle);
  if (!sp) {
    console.error("sproto.createNew returned null. Is the bundle valid?");
    process.exit(2);
  }

  console.log("sproto instance created.");

  // create a host for package "base.package"
  const client = sp.host("base.package");

  // create an attach (request) function bound to this sp
  const clientRequest = client.attach(sp);

  const data = {
    token: "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50Ijoicm9ib3QzIiwiaWF0IjoxNzYxMDQ0MTIzLCJleHAiOjE3NjEwNDQxODN9.a81G0g0iYM2oLZA-3rjqouZHGha_j2If7ZRvWTI5PyygZ9uZ21HaaOvmVAVNFCpNUJpflm6IClTPkKPXygz-AQ",
    ctx: {
      rid: 0,
      proto_checksum: "unknow",
    },
  };

  // build request buffer (packed)
  const req = clientRequest("login.login", data);
  console.log("packed request (byte length):", req.length);
    console.log(Array.from(req).map(b => b.toString(16).padStart(2, '0')).join(' '));


  // dispatch the packed request to the host (simulate receive)
  const ret = client.dispatch(req);
  console.log("dispatch return:", ret);
} catch (err) {
  console.error("error:", err);
  process.exit(99);
}
