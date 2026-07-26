# OST market crank — persistent, KV-free, off the OST page.
# Talks straight to Solana RPC + Pyth Hermes; needs no Cloudflare KV/worker,
# so it keeps 5-min markets moving even if the OST worker's KV is exhausted.
#
# Runtime env:
#   OST_CRANK_KEY  base64 (or JSON array) of the crank authority's 64-byte secret
#   OST_RPC        a DEDICATED devnet RPC url (public api.devnet.solana.com 429s)
#
# Deploy as a always-on worker (Render / Railway / Fly.io / any VPS):
#   docker build -t ost-crank scripts/pyth-crank
#   docker run -e OST_CRANK_KEY=... -e OST_RPC=... ost-crank
FROM node:22-slim
WORKDIR /crank
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV OST_RPC=https://api.devnet.solana.com
CMD ["node", "crank.mjs", "--watch"]
