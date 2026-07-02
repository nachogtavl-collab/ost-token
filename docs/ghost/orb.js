/* ============================================================
   ghost/orb.js — Summoning Circle WebGL orb
   Single living shader. Pulses, breathes, reacts to state.
   ============================================================ */

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Fragment shader: a living orb made of layered noise + glow.
// Uniforms drive its breathing, intensity, and "thinking" state.
const FRAGMENT_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2  u_res;
uniform float u_intensity;   // 0..1  current activity
uniform float u_listen;      // 0..1  listening (input focused)
uniform float u_speak;       // 0..1  generating reply

// Hash + simplex-ish noise (compact, good enough for breathing)
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy / u_res.xy) - 0.5;
  uv.x *= u_res.x / u_res.y;

  float t = u_time * 0.18;
  float d = length(uv);

  // Breathing radius
  float breathe = 0.22 + 0.012 * sin(u_time * 0.9)
                       + 0.022 * u_intensity
                       + 0.030 * u_speak;

  // Core orb
  float core = smoothstep(breathe + 0.02, breathe - 0.04, d);

  // Inner swirl using fbm
  vec2 swirl = uv * 2.4 + vec2(t, -t * 0.7);
  float n = fbm(swirl + fbm(swirl + t));
  float inner = core * (0.55 + 0.45 * n);

  // Outer halo
  float halo = smoothstep(breathe + 0.45, breathe, d);
  halo *= (0.25 + 0.20 * sin(u_time * 0.6 + d * 12.0));
  halo *= (0.6 + 0.4 * u_intensity);

  // Listening ripples
  float ripple = 0.0;
  if (u_listen > 0.001) {
    float r = mod(u_time * 0.7, 1.4);
    ripple = smoothstep(0.02, 0.0, abs(d - (breathe + r * 0.35))) * (1.0 - r / 1.4);
    ripple *= u_listen * 0.55;
  }

  // Speaking shimmer
  float shimmer = 0.0;
  if (u_speak > 0.001) {
    shimmer = sin((d * 60.0) - u_time * 6.0) * 0.5 + 0.5;
    shimmer *= core * u_speak * 0.35;
  }

  // Color palette: deep indigo core -> electric cyan rim -> violet halo
  vec3 cCore  = vec3(0.55, 0.78, 1.00);
  vec3 cRim   = vec3(0.40, 0.55, 1.00);
  vec3 cHalo  = vec3(0.30, 0.20, 0.65);
  vec3 cSpeak = vec3(0.85, 0.95, 1.00);

  vec3 col = mix(cHalo, cRim, core);
  col = mix(col, cCore, inner);
  col += halo * cHalo * 1.2;
  col += ripple * cRim;
  col += shimmer * cSpeak;

  // Subtle starfield in the background void
  float stars = step(0.997, hash(floor(uv * 800.0))) * 0.6;
  col += stars * (1.0 - core);

  // Fade alpha by core+halo presence (rest is transparent dark)
  float alpha = clamp(core + halo + ripple, 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Ghost orb shader compile error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export class GhostOrb {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true })
           || canvas.getContext('experimental-webgl');
    this.state = { intensity: 0, listen: 0, speak: 0 };
    this.target = { intensity: 0, listen: 0, speak: 0 };
    this.startTime = performance.now();
    this.running = false;
    if (!this.gl) {
      console.warn('Ghost: WebGL unavailable, falling back to CSS orb.');
      this.fallback = true;
      return;
    }
    this.fallback = false;
    this._initGL();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _initGL() {
    const gl = this.gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) { this.fallback = true; return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Ghost orb link error:', gl.getProgramInfoLog(prog));
      this.fallback = true;
      return;
    }
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'a_pos');
    this.uTime = gl.getUniformLocation(prog, 'u_time');
    this.uRes  = gl.getUniformLocation(prog, 'u_res');
    this.uInt  = gl.getUniformLocation(prog, 'u_intensity');
    this.uLis  = gl.getUniformLocation(prog, 'u_listen');
    this.uSpk  = gl.getUniformLocation(prog, 'u_speak');

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1
    ]), gl.STATIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth  || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width  = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setState(partial) {
    Object.assign(this.target, partial);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  _frame() {
    // Smooth state -> target
    const lerp = (a, b, k) => a + (b - a) * k;
    this.state.intensity = lerp(this.state.intensity, this.target.intensity, 0.06);
    this.state.listen    = lerp(this.state.listen,    this.target.listen,    0.10);
    this.state.speak     = lerp(this.state.speak,     this.target.speak,     0.08);

    if (this.fallback) return;
    const gl = this.gl;
    const t = (performance.now() - this.startTime) / 1000;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(this.uTime, t);
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uInt, this.state.intensity);
    gl.uniform1f(this.uLis, this.state.listen);
    gl.uniform1f(this.uSpk, this.state.speak);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
