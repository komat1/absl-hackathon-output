import { useEffect, useRef } from "react";

/**
 * The panel's background — the "Orb" from React Bits (reactbits.dev, MIT),
 * ported to plain WebGL so one shader does not drag in `ogl`. The shader is the
 * original; only the colours changed (the brand instead of purple-teal) and the
 * control: instead of the mouse hovering it, `active` ripples it — that is,
 * while the copilot is querying.
 *
 * Under prefers-reduced-motion it draws one frame and stands still. Without
 * WebGL the panel simply has no backdrop — nothing breaks.
 */
const VERT = `
precision highp float;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform float iTime;
uniform vec3 iResolution;
uniform float hover;
uniform float rot;
uniform vec3 backgroundColor;
varying vec2 vUv;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}
float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(vec4(31.316), n);
}
vec4 extractAlpha(vec3 colorIn) {
  float a = max(max(colorIn.r, colorIn.g), colorIn.b);
  return vec4(colorIn.rgb / (a + 1e-5), a);
}
const vec3 color1 = vec3(0.886, 0.231, 0.259);
const vec3 color2 = vec3(0.973, 0.580, 0.365);
const vec3 color3 = vec3(0.180, 0.050, 0.070);
const float innerRadius = 0.6;
const float noiseScale = 0.65;
float light1(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * attenuation); }
float light2(float intensity, float attenuation, float dist) { return intensity / (1.0 + dist * dist * attenuation); }

vec4 draw(vec2 uv) {
  float ang = atan(uv.y, uv.x);
  float len = length(uv);
  float invLen = len > 0.0 ? 1.0 / len : 0.0;
  float bgLuminance = dot(backgroundColor, vec3(0.299, 0.587, 0.114));
  float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
  float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
  float d0 = distance(uv, (r0 * invLen) * uv);
  float v0 = light1(1.0, 10.0, d0);
  v0 *= smoothstep(r0 * 1.05, r0, len);
  float innerFade = smoothstep(r0 * 0.8, r0 * 0.95, len);
  v0 *= mix(innerFade, 1.0, bgLuminance * 0.7);
  float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;
  float a = iTime * -1.0;
  vec2 pos = vec2(cos(a), sin(a)) * r0;
  float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d);
  v1 *= light1(1.0, 50.0, d0);
  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
  vec3 colBase = mix(color1, color2, cl);
  float fadeAmount = mix(1.0, 0.1, bgLuminance);
  vec3 darkCol = mix(color3, colBase, v0);
  darkCol = (darkCol + v1) * v2 * v3;
  darkCol = clamp(darkCol, 0.0, 1.0);
  vec3 lightCol = (colBase + v1) * mix(1.0, v2 * v3, fadeAmount);
  lightCol = clamp(lightCol, 0.0, 1.0);
  // The original shader BLENDS these two branches by background luminance,
  // which on a dark panel mixed a little of the panel colour into every pixel
  // of the canvas — the orb then sat in a faintly visible square. So the
  // branch is chosen, not blended.
  if (bgLuminance < 0.5) return extractAlpha(darkCol);
  // The light branch used to draw mix(background, colour, v0) — opaque, over a
  // background READ OFF the page. Where that read the wrong colour, the orb sat
  // in a white square. Alpha v0 over whatever is actually behind gives the same
  // picture without having to be right about it.
  return vec4(lightCol, v0);
}

void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 center = iResolution.xy * 0.5;
  float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center) / size * 2.0;
  float s = sin(rot);
  float c = cos(rot);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  uv.x += hover * 0.03 * sin(uv.y * 10.0 + iTime);
  uv.y += hover * 0.03 * sin(uv.x * 10.0 + iTime);
  vec4 col = draw(uv);
  // Transparent (premultiplied): outside the ring alpha is 0, so the canvas has
  // no edge that can be told apart from the panel.
  gl_FragColor = vec4(col.rgb * col.a, col.a);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** The colour the orb lies on — the shader switches dark/light by its luminance. */
function readBackground(el: HTMLElement): [number, number, number] {
  let node: HTMLElement | null = el;
  while (node) {
    const match = getComputedStyle(node).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (match && (match[4] === undefined || Number(match[4]) > 0)) {
      return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
    }
    node = node.parentElement;
  }
  return [0, 0, 0];
}

export function SiriOrb({ active = false, className }: { active?: boolean; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return; // Without WebGL the panel keeps its flat background.
    host.appendChild(canvas);

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      host.removeChild(canvas);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    // One triangle covering the whole surface (the same trick as ogl's Triangle).
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "iTime");
    const uRes = gl.getUniformLocation(program, "iResolution");
    const uHover = gl.getUniformLocation(program, "hover");
    const uRot = gl.getUniformLocation(program, "rot");
    const uBg = gl.getUniformLocation(program, "backgroundColor");
    gl.clearColor(0, 0, 0, 0);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(host.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(host.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform3f(uRes, canvas.width, canvas.height, canvas.width / canvas.height);
      gl.uniform3f(uBg, ...readBackground(host));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    // Switching the theme changes the panel colour — the canvas has to follow.
    const themeObserver = new MutationObserver(() => gl.uniform3f(uBg, ...readBackground(host)));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });

    // Under reduced motion it draws once, so the theme has to be set by now.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let hover = 0;
    let rot = 0;
    let last = 0;
    let raf = 0;
    const frame = (t: number) => {
      const dt = last ? (t - last) / 1000 : 0;
      last = t;
      hover += ((activeRef.current ? 1 : 0) - hover) * 0.06;
      rot += dt * 0.3 * hover;
      gl.uniform1f(uTime, t / 1000);
      gl.uniform1f(uHover, hover);
      gl.uniform1f(uRot, rot);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      themeObserver.disconnect();
      if (canvas.parentNode === host) host.removeChild(canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <div ref={hostRef} className={className} aria-hidden />;
}
