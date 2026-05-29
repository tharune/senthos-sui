const { Keypair } = require("@solana/web3.js");
const fs = require("fs");
const k = Keypair.generate();
fs.writeFileSync("fake-key.json", JSON.stringify(Array.from(k.secretKey)));
console.log("Wrote fake-key.json with pubkey:", k.publicKey.toBase58());
