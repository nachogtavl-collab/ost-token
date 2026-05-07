/* ============================================================
   ghost/signal.js — Signal layer (Layer 5)
   Web Bluetooth + Web NFC + WebRTC LAN. Browser-only, so the
   ceiling is what those APIs allow. Native (Tauri/Capacitor)
   shells can replace this module to unlock raw radios.
   ============================================================ */

export class GhostSignal {
  constructor() {
    this.btDevice = null;
    this.nfcReader = null;
  }

  capabilities() {
    return {
      bluetooth: typeof navigator !== 'undefined' && !!navigator.bluetooth,
      nfc:       typeof window !== 'undefined' && 'NDEFReader' in window,
      webrtc:    typeof RTCPeerConnection !== 'undefined'
    };
  }

  /**
   * Scan for a nearby Ghost beacon over Bluetooth. Requires user gesture.
   * Returns the chosen device or null if unsupported / cancelled.
   */
  async scanBluetooth(serviceUuid = 0x180F /* placeholder: battery svc */) {
    if (!navigator.bluetooth) return null;
    try {
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [serviceUuid]
      });
      this.btDevice = dev;
      return dev;
    } catch { return null; }
  }

  /** Tap a Ghost handshake via Web NFC (Android Chrome only). */
  async tapNfc(onMessage) {
    if (!('NDEFReader' in window)) return false;
    try {
      const reader = new window.NDEFReader();
      await reader.scan();
      this.nfcReader = reader;
      reader.onreading = (event) => {
        const msgs = [];
        for (const rec of event.message.records) {
          const dec = new TextDecoder(rec.encoding || 'utf-8');
          msgs.push({ type: rec.recordType, text: dec.decode(rec.data) });
        }
        if (onMessage) onMessage(msgs);
      };
      return true;
    } catch { return false; }
  }
}
