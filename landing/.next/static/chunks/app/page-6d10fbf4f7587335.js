(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[974],{1544:(e,t,i)=>{"use strict";i.d(t,{Scene:()=>C});var o=i(5155),r=i(2115),n=i(2011),a=i(6275),l=i(9370),s=i(1535);let u=null;function m(){if(u)return u;let e={hasWebGL2:!1,hasFloatRT:!1,hasFloatLinear:!1,isMobile:!0,canUseFluidSim:!1};if("u"<typeof document)return e;let t=document.createElement("canvas").getContext("webgl2");if(!t)return u=e,e;let i=null!==t.getExtension("EXT_color_buffer_float"),o=null!==t.getExtension("OES_texture_float_linear");return u={hasWebGL2:!0,hasFloatRT:i,hasFloatLinear:o,isMobile:function(){if("u"<typeof navigator)return!0;let e=navigator.maxTouchPoints>0,t=navigator.userAgent.toLowerCase(),i=/iphone|ipad|ipod/.test(t),o=/android/.test(t),r=window.innerWidth<768;return e&&(i||o||r)}(),canUseFluidSim:i&&o}}let c={simRes:256,particleCount:5e4,dprClamp:1.5,useFluidSim:!1,tierName:"mobile"},d={simRes:512,particleCount:15e4,dprClamp:2,useFluidSim:!0,tierName:"desktop"},f={simRes:256,particleCount:5e4,dprClamp:1.5,useFluidSim:!1,tierName:"mobile"},p={hasWebGL2:!1,hasFloatRT:!1,hasFloatLinear:!1,isMobile:!0,canUseFluidSim:!1},h=(0,s.v)((e,t)=>({tier:f,capabilities:p,initialized:!1,initialize:()=>{let i,o;if(t().initialized)return;let r=m();e({tier:((o=(i=m()).isMobile?{...c}:{...d}).useFluidSim=i.canUseFluidSim,o),capabilities:r,initialized:!0})}}));var v=i(5269);let w=(e,t)=>{let i=43758.5453123*Math.sin((e+1)*127.1+311.7*t);return i-Math.floor(i)};function g({count:e=3e3,color1:t="#FFEDE4",color2:i="#FFFFFF",color3:a="#DDF6FF",circleRadius:l=1.2,mouseInfluenceRadius:s=2,mouseRepelStrength:u=.6,returnSpeed:m=.03}){let c=(0,r.useRef)(null),d=function(){let[e,t]=(0,r.useState)({x:0,y:0});return(0,r.useEffect)(()=>{let e=e=>{t({x:e.clientX/window.innerWidth*2-1,y:-(2*(e.clientY/window.innerHeight))+1})};return window.addEventListener("mousemove",e),e({clientX:window.innerWidth/2,clientY:window.innerHeight/2}),()=>{window.removeEventListener("mousemove",e)}},[]),e}(),f=(0,r.useMemo)(()=>new v.Zcv(new v.Pq0(0,0,1),0),[]),p=(0,r.useMemo)(()=>new v.tBo,[]),h=(0,r.useMemo)(()=>new v.Pq0,[]),g=(0,r.useMemo)(()=>{let t=new Float32Array(3*e),i=new Float32Array(e),o=new Float32Array(e),r=new Float32Array(e),n=new Float32Array(e),a=new Float32Array(e);for(let s=0;s<e;s++){let e=w(s,.13)*Math.PI*2;n[s]=e;let u=l+.05+.1*w(s,.29);a[s]=u;let m=Math.cos(e)*u,c=Math.sin(e)*u;t[3*s]=m,t[3*s+1]=c,t[3*s+2]=0,i[s]=.2+.4*w(s,.47),o[s]=w(s,.61)*Math.PI*2,r[s]=.03+.15*w(s,.83)}return{positions:t,speeds:i,phases:o,sizes:r,angles:n,distances:a}},[e,l]),x=(0,r.useMemo)(()=>{let o=new Float32Array(3*e);for(let r=0;r<e;r++){let e=w(r,1.17),n=new v.Q1f(a);e<.33?n=new v.Q1f(t):e<.66&&(n=new v.Q1f(i)),o[3*r]=n.r,o[3*r+1]=n.g,o[3*r+2]=n.b}return o},[e,t,i,a]),b=(0,r.useMemo)(()=>{let e=new v.LoY;return e.setAttribute("position",new v.THS(g.positions,3)),e.setAttribute("color",new v.THS(x,3)),e.setAttribute("speed",new v.THS(g.speeds,1)),e.setAttribute("phase",new v.THS(g.phases,1)),e.setAttribute("pSize",new v.THS(g.sizes,1)),e.setAttribute("angle",new v.THS(g.angles,1)),e.setAttribute("initialDist",new v.THS(g.distances,1)),e},[g,x]),C=`
    uniform float uTime;
    uniform float uCircleRadius;
    uniform vec2 uMouse;
    uniform float uMouseInfluenceRadius;
    uniform float uMouseRepelStrength;
    uniform float uReturnSpeed;

    attribute float speed;
    attribute float phase;
    attribute float pSize;
    attribute float angle;
    attribute float initialDist;
    attribute vec3 color;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      float t = uTime * 1.2 + phase;
      float pulse = (sin(t) * 0.4 + 0.6) * speed;

      float maxDist = uCircleRadius + 0.8;
      float minDist = uCircleRadius + 0.1;
      float currentDist = minDist + (maxDist - minDist) * pulse;

      float baseX = cos(angle) * currentDist;
      float baseY = sin(angle) * currentDist;
      vec2 basePos = vec2(baseX, baseY);

      vec2 mouseVec = basePos - uMouse;
      float mouseDist = length(mouseVec);

      vec2 finalPos = basePos;
      if (mouseDist < uMouseInfluenceRadius) {
        float influence = (1.0 - mouseDist / uMouseInfluenceRadius) * uMouseRepelStrength;
        vec2 repelDir = normalize(mouseVec);
        finalPos += repelDir * influence * 0.5;
        finalPos = mix(finalPos, basePos, uReturnSpeed);
      }

      vec3 newPosition = vec3(finalPos.x, finalPos.y, 0.0);
      vColor = color;
      vAlpha = 0.8 + pulse * 0.2;

      vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      float size = pSize * 2.0;
      gl_PointSize = size * (150.0 / (1.0 + length(mvPosition.xyz)));
    }
  `,y=`
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      vec2 p = gl_PointCoord - vec2(0.5);
      float r = length(p);

      float edge = 0.45;
      float aa = fwidth(r);
      float alpha = 1.0 - smoothstep(edge - aa, edge + aa, r);

      if (alpha <= 0.0) discard;

      float sparkle = sin(gl_PointCoord.x * 12.0) * sin(gl_PointCoord.y * 12.0) * 0.08;
      vec3 finalColor = vColor + sparkle;

      gl_FragColor = vec4(finalColor, alpha * vAlpha * 0.95);
    }
  `,F=(0,r.useMemo)(()=>({uTime:{value:0},uCircleRadius:{value:l},uMouse:{value:new v.I9Y(100,100)},uMouseInfluenceRadius:{value:s},uMouseRepelStrength:{value:u},uReturnSpeed:{value:m}}),[l,s,u,m]);return(0,n.D)(e=>{c.current&&(c.current.material.uniforms.uTime.value=e.clock.elapsedTime,p.setFromCamera(new v.I9Y(d.x,d.y),e.camera),p.ray.intersectPlane(f,h)&&(c.current.parent&&c.current.parent.worldToLocal(h),c.current.material.uniforms.uMouse.value.set(h.x,h.y)))}),(0,o.jsx)("points",{ref:c,geometry:b,frustumCulled:!1,children:(0,o.jsx)("shaderMaterial",{vertexShader:C,fragmentShader:y,uniforms:F,transparent:!0,depthWrite:!1,blending:v.EZo})})}function x({colorA:e="#F4EFF7",colorB:t="#E6B2A0",colorC:i="#866AD6",...a}){let l=(0,r.useRef)(null),s=(0,r.useMemo)(()=>({uTime:{value:0},uColorA:{value:new v.Q1f(e)},uColorB:{value:new v.Q1f(t)},uColorC:{value:new v.Q1f(i)},uGlow:{value:1},uRimWidth:{value:1.05},uRimPower:{value:3.5},uRimIntensity:{value:.5},uGrain:{value:.03},uOpacity:{value:1}}),[e,t,i]),u=`
    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    varying vec3 vViewDirW;

    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;

      // world-space normal
      vNormalW = normalize(mat3(modelMatrix) * normal);

      // view direction (world)
      vViewDirW = normalize(cameraPosition - vWorldPos);

      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,m=`
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    uniform float uGlow;
    uniform float uRimWidth;
    uniform float uRimPower;
    uniform float uRimIntensity;
    uniform float uGrain;
    uniform float uOpacity;

    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    varying vec3 vViewDirW;

    float hash(vec3 p) {
      p  = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    void main() {
      vec3 N = normalize(vNormalW);
      vec3 V = normalize(vViewDirW);

      float dotProduct = dot(N, V);

      vec3 lightingN = N;
      if (dotProduct < 0.0) {
        lightingN = -N;
      }

      float ndv = clamp(dot(lightingN, V), 0.0, 1.0);
      float rim = pow(1.0 - ndv, uRimPower);

      float whiteRim = smoothstep(1.0 - uRimWidth, 1.0, rim);

      // Drive the gradient by sphere curvature so color wraps with the orb volume.
      float centerToEdge = 1.0 - ndv;
      float radialGradient = pow(clamp(centerToEdge, 0.0, 1.0), 0.72);
      float hemisphereGradient = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
      float azimuth = atan(N.z, N.x) / 6.28318530718 + 0.5;
      float azimuthWarp = sin(azimuth * 6.28318530718) * 0.045;
      float finalGradient = clamp(mix(hemisphereGradient, radialGradient, 0.72) + azimuthWarp, 0.0, 1.0);

      // Smooth palette crossfades with explicit protection of the center core.
      vec3 cToB = mix(uColorC, uColorB, smoothstep(0.02, 0.52, finalGradient));
      vec3 bToA = mix(uColorB, uColorA, smoothstep(0.30, 0.82, finalGradient));
      vec3 aToC = mix(uColorA, uColorC, pow(smoothstep(0.62, 1.0, finalGradient), 1.25));
      vec3 blendedColor = mix(cToB, bToA, smoothstep(0.22, 0.72, finalGradient));
      blendedColor = mix(blendedColor, aToC, smoothstep(0.68, 0.98, finalGradient));

      // Keep the center decisively lavender/purple, but feather its boundary
      // so it blends into the peach region more smoothly.
      float coreMask = 1.0 - smoothstep(0.06, 0.56, radialGradient);
      float coreOpacity = pow(clamp(coreMask, 0.0, 1.0), 1.7);
      vec3 coreTone = mix(uColorC, uColorB, 0.14);
      blendedColor = mix(blendedColor, coreTone, coreOpacity * 0.9);

      // Pull peach inward with a long soft falloff from the outer/mid body.
      float inwardPeach =
        smoothstep(0.24, 0.92, radialGradient) *
        smoothstep(0.20, 0.88, finalGradient) *
        (1.0 - coreMask);
      blendedColor = mix(blendedColor, uColorB, inwardPeach * 0.28);

      float viewGradient = clamp(dot(lightingN, V) * 0.5 + 0.5, 0.0, 1.0);
      blendedColor = mix(blendedColor, blendedColor * 1.1, viewGradient * 0.3);

      float grain = (hash(vWorldPos * 50.0 + uTime) - 0.5) * uGrain;
      blendedColor += grain;

      vec3 whiteRimCol = vec3(1.0, 0.98, 0.95);
      float rimStrength = whiteRim * uRimIntensity;

      vec3 finalCol = mix(blendedColor, whiteRimCol, rimStrength);
      finalCol += whiteRimCol * whiteRim * 0.2;
      finalCol *= (0.95 + uGlow * 0.05);

      if (dotProduct < 0.0) {
        finalCol *= 0.9;
      }

      gl_FragColor = vec4(finalCol, uOpacity);
    }
  `;return(0,r.useEffect)(()=>{l.current&&(l.current.uniforms.uColorA.value.set(e),l.current.uniforms.uColorB.value.set(t),l.current.uniforms.uColorC.value.set(i))},[e,t,i]),(0,n.D)((e,t)=>{l.current&&(l.current.uniforms.uTime.value+=.5*t)}),(0,o.jsxs)("mesh",{...a,children:[(0,o.jsx)("sphereGeometry",{args:[1.5,256,256]}),(0,o.jsx)("shaderMaterial",{ref:l,uniforms:s,vertexShader:u,fragmentShader:m,transparent:!1,depthWrite:!0,depthTest:!0,blending:v.NTi,side:v.$EB})]})}function b(){let e=-(0,n.C)(e=>e.viewport).height/2+1/3*13.200000000000001-6.6000000000000005-1.3;return(0,o.jsxs)(o.Fragment,{children:[(0,o.jsx)("ambientLight",{intensity:.8}),(0,o.jsx)("pointLight",{position:[5,5,7],intensity:.8}),(0,o.jsx)("pointLight",{position:[-6,4,6],intensity:.6,color:"#EEDDEE"}),(0,o.jsx)("pointLight",{position:[0,-5,5],intensity:.4,color:"#E8A0B1"}),(0,o.jsx)("pointLight",{position:[3,-2,8],intensity:.3,color:"#ECF1FA"}),(0,o.jsx)("directionalLight",{position:[-8,5,5],intensity:.7,color:"#866AD6"}),(0,o.jsxs)("group",{position:[0,e,0],scale:4.4,children:[(0,o.jsx)(x,{position:[0,0,0],renderOrder:20,colorA:"#B37FD3",colorB:"#E8A0B1",colorC:"#9C66CA"}),(0,o.jsx)(g,{count:3500,color1:"#FBFAFC",color2:"#F3C8C0",color3:"#ECF1FA",circleRadius:1.4,mouseInfluenceRadius:.15,mouseRepelStrength:.1,returnSpeed:.18})]}),(0,o.jsx)(l.s0,{children:(0,o.jsx)(l.mK,{intensity:.36,luminanceThreshold:.38,luminanceSmoothing:.2,radius:.5})})]})}function C(){let e=h(e=>e.initialize),t=h(e=>e.tier.dprClamp);return(0,r.useEffect)(()=>{e()},[e]),(0,o.jsx)("div",{className:"h-full w-full landing-scene-enter",children:(0,o.jsx)(a.Hl,{camera:{position:[0,0,15],fov:35,near:.1,far:50},dpr:[1,Math.min(2,t)],gl:{antialias:!0,alpha:!0,powerPreference:"high-performance",preserveDrawingBuffer:!0,depth:!0},style:{width:"100%",height:"100%"},children:(0,o.jsx)(r.Suspense,{fallback:null,children:(0,o.jsx)(b,{})})})})}},3824:(e,t,i)=>{Promise.resolve().then(i.t.bind(i,6928,23)),Promise.resolve().then(i.t.bind(i,4372,23)),Promise.resolve().then(i.bind(i,1544)),Promise.resolve().then(i.bind(i,5360))},5360:(e,t,i)=>{"use strict";i.d(t,{EmailCaptureOverlay:()=>l});var o=i(5155),r=i(2115);let n="https://docs.google.com/forms/d/e/1FAIpQLSekoLhiCK3FWZSmEFK8zCjbW07KRt54aC0rsX3DvgGjeYeLUg/formResponse",a="entry.1074598404";function l(){let[e,t]=(0,r.useState)(""),[i,l]=(0,r.useState)("idle"),[s,u]=(0,r.useState)("");async function m(e){let i=e.trim().toLowerCase();if(i){if(!n||!a){l("error"),u("Signups are temporarily unavailable.");return}l("submitting"),u("");try{let e=new URLSearchParams({[a]:i});await fetch(n,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:e.toString()}),l("success"),u("Thanks. Your email has been received."),t("")}catch{l("error"),u("Could not submit right now. Please try again.")}}}return(0,o.jsx)("section",{className:"landing-overlay-enter pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-5 pb-40 md:pb-52",children:(0,o.jsxs)("div",{className:"pointer-events-auto w-full max-w-2xl text-center",children:[(0,o.jsx)("p",{className:"font-[family-name:var(--font-body)] text-[10px] tracking-[0.2em] text-[#5E4A90]/82 uppercase",children:"SIGN UP FOR EARLY ACCESS"}),(0,o.jsx)("h1",{className:"mt-2 font-[family-name:var(--font-display)] text-[1.9rem] leading-[1.08] text-[#3B2B66] md:text-[2.8rem]",children:"Amodel, the only way to manage your inbox and calendar."}),(0,o.jsxs)("form",{className:"mt-5 w-full",onSubmit:async t=>{t.preventDefault(),await m(e)},children:[(0,o.jsx)("label",{htmlFor:"waitlist-email",className:"sr-only",children:"Email address"}),(0,o.jsxs)("div",{className:"relative mx-auto max-w-md",children:[(0,o.jsx)("input",{id:"waitlist-email",name:"email",type:"email",required:!0,value:e,onChange:e=>t(e.target.value),placeholder:"you@company.com",disabled:"submitting"===i,className:"h-11 w-full rounded-full border border-[#CFBEE8] bg-white/72 px-4 pr-14 font-[family-name:var(--font-body)] text-sm text-[#2F2354] outline-none backdrop-blur-sm transition focus:border-[#8C6FD6] focus:ring-4 focus:ring-[#B89EF3]/30"}),(0,o.jsx)("button",{type:"submit","aria-label":"Join waitlist",disabled:"submitting"===i,className:"absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-[#6D4AC5] text-white shadow-[0_6px_14px_rgba(77,48,153,0.45)] transition hover:bg-[#5C3DB1] focus:ring-4 focus:ring-[#A78AF0]/40 focus:outline-none",children:(0,o.jsx)("svg",{viewBox:"0 0 24 24",fill:"none",xmlns:"http://www.w3.org/2000/svg",className:"h-4 w-4",children:(0,o.jsx)("path",{d:"M5 12H19M19 12L13 6M19 12L13 18",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"})})})]})]}),(0,o.jsx)("p",{className:`mt-2 h-5 overflow-hidden text-ellipsis whitespace-nowrap font-[family-name:var(--font-body)] text-[11px] leading-5 transition-opacity ${"error"===i?"text-[#7A2844]":"text-[#56447D]/80"} ${"idle"===i?"opacity-0":"opacity-100"}`,"aria-live":"polite",children:"idle"===i?"\xa0":"submitting"===i?"Submitting...":s})]})})}}},e=>{e.O(0,[49,367,831,664,413,274,654,441,794,358],()=>e(e.s=3824)),_N_E=e.O()}]);