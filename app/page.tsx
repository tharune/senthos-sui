"use client";
import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import { C, FS, FD, FM, EASE } from "./app/_lib/tokens";
import { ThemeToggle } from "./app/_lib/theme";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}
const MobileCtx = createContext(false);
const useMobile = () => useContext(MobileCtx);

function genHistory(tier: number, days: number, finalNav: number) {
  const base = tier / 100; const pts: number[] = []; let v = base;
  for (let i = 0; i < days; i++) {
    const drift = (finalNav - base) * (i / days) * 0.6;
    const noise = (Math.random() - 0.48) * 0.018;
    const spike = Math.random() < 0.08 ? (Math.random() - 0.5) * 0.03 : 0;
    v = base + drift + noise + spike;
    v = Math.max(tier/100 - 0.08, Math.min(tier/100 + 0.12, v));
    pts.push(parseFloat(v.toFixed(4)));
  }
  pts.push(finalNav); return pts;
}
function genFlatHistory(days: number) {
  const pts: number[] = [];
  for (let i = 0; i <= days; i++) pts.push(parseFloat((1 + (Math.random()-0.5)*0.0004).toFixed(4)));
  return pts;
}
const USDC_HISTORY = genFlatHistory(29);

const BUNDLES = [
  { id:"STHS-90-0430", tier:90, date:"Apr 30, 2025", daysLeft:15, nav:0.913, issue:0.90, change:+1.4, hot:true,  resolved:3, totalLegs:10, history:genHistory(90,29,0.913) },
  { id:"STHS-90-0515", tier:90, date:"May 15, 2025", daysLeft:30, nav:0.908, issue:0.90, change:+0.9, hot:true,  resolved:1, totalLegs:12, history:genHistory(90,29,0.908) },
  { id:"STHS-90-0601", tier:90, date:"Jun 1, 2025",  daysLeft:47, nav:0.895, issue:0.90, change:-0.6, hot:false, resolved:0, totalLegs:10, history:genHistory(90,29,0.895) },
  { id:"STHS-90-0701", tier:90, date:"Jul 1, 2025",  daysLeft:77, nav:0.901, issue:0.90, change:+0.1, hot:false, resolved:0, totalLegs:11, history:genHistory(90,29,0.901) },
  { id:"STHS-90-1001", tier:90, date:"Oct 1, 2025",  daysLeft:169,nav:0.888, issue:0.90, change:-0.3, hot:false, resolved:0, totalLegs:10, history:genHistory(90,29,0.888) },
  { id:"STHS-70-0430", tier:70, date:"Apr 30, 2025", daysLeft:15, nav:0.724, issue:0.70, change:+3.4, hot:true,  resolved:4, totalLegs:10, history:genHistory(70,29,0.724) },
  { id:"STHS-70-0515", tier:70, date:"May 15, 2025", daysLeft:30, nav:0.698, issue:0.70, change:-1.2, hot:false, resolved:2, totalLegs:11, history:genHistory(70,29,0.698) },
  { id:"STHS-70-0601", tier:70, date:"Jun 1, 2025",  daysLeft:47, nav:0.712, issue:0.70, change:+1.7, hot:false, resolved:1, totalLegs:10, history:genHistory(70,29,0.712) },
  { id:"STHS-70-0701", tier:70, date:"Jul 1, 2025",  daysLeft:77, nav:0.685, issue:0.70, change:-2.1, hot:false, resolved:0, totalLegs:12, history:genHistory(70,29,0.685) },
  { id:"STHS-70-1001", tier:70, date:"Oct 1, 2025",  daysLeft:169,nav:0.703, issue:0.70, change:+0.4, hot:false, resolved:0, totalLegs:10, history:genHistory(70,29,0.703) },
  { id:"STHS-50-0430", tier:50, date:"Apr 30, 2025", daysLeft:15, nav:0.531, issue:0.50, change:+6.2, hot:true,  resolved:5, totalLegs:10, history:genHistory(50,29,0.531) },
  { id:"STHS-50-0515", tier:50, date:"May 15, 2025", daysLeft:30, nav:0.488, issue:0.50, change:-2.4, hot:false, resolved:1, totalLegs:10, history:genHistory(50,29,0.488) },
  { id:"STHS-50-0601", tier:50, date:"Jun 1, 2025",  daysLeft:47, nav:0.502, issue:0.50, change:+0.4, hot:false, resolved:0, totalLegs:11, history:genHistory(50,29,0.502) },
  { id:"STHS-50-0701", tier:50, date:"Jul 1, 2025",  daysLeft:77, nav:0.478, issue:0.50, change:-4.4, hot:false, resolved:0, totalLegs:10, history:genHistory(50,29,0.478) },
  { id:"STHS-50-1001", tier:50, date:"Oct 1, 2025",  daysLeft:169,nav:0.515, issue:0.50, change:+3.0, hot:false, resolved:0, totalLegs:10, history:genHistory(50,29,0.515) },
];
type Bundle = typeof BUNDLES[0];

// Non-demo fallback (only used if someone explicitly flips demo OFF)
const STATIC_PORTFOLIO = [
  { id:"STHS-90-0430", qty:1200, avgCost:0.887 },
  { id:"STHS-70-0430", qty:800,  avgCost:0.682 },
  { id:"STHS-50-0430", qty:600,  avgCost:0.501 },
  { id:"STHS-90-0515", qty:500,  avgCost:0.899 },
  { id:"STHS-70-0515", qty:400,  avgCost:0.708 },
  { id:"STHS-70-0601", qty:98,   avgCost:0.714 },
];
const STATIC_VAULT_POSITIONS = [
  { id:"VAULT-0601", label:"Meteora vault", principal:930, yieldEarned:9.64, apy:8.4, daysLeft:47, daysTotal:90, resolveDate:"Jun 1, 2025" },
];
const STATIC_USDC_BALANCE = 680;

type Position = { id:string, qty:number, avgCost:number };
type VaultPos = { id:string, label:string, principal:number, yieldEarned:number, apy:number, daysLeft:number, daysTotal:number, resolveDate:string };

const DEMO_STARTING_USDC = 10000;

const NEWS = [
  { headline:"Federal Reserve signals no rate cuts in near term", source:"Reuters", time:"2m ago", impact:"neutral" },
  { headline:"Bitcoin breaks above $95k as ETF inflows hit monthly high", source:"Bloomberg", time:"8m ago", impact:"positive" },
  { headline:"Senate fails to advance budget resolution ahead of deadline", source:"WSJ", time:"14m ago", impact:"negative" },
  { headline:"Sui prediction-market activity accelerates ahead of hackathon demos", source:"Senthos Desk", time:"22m ago", impact:"positive" },
  { headline:"Global PMI data signals manufacturing slowdown in Q2", source:"FT", time:"31m ago", impact:"negative" },
  { headline:"NVIDIA beats Q1 estimates, raises full-year guidance", source:"CNBC", time:"45m ago", impact:"positive" },
];
const HOT_PREDICTIONS = [
  { label:"BTC above $100k by May", prob:67.4, change:+3.2 },
  { label:"Fed holds rates in June", prob:91.2, change:-0.4 },
  { label:"ETH flips BNB market cap", prob:54.8, change:+5.1 },
  { label:"US avoids recession in 2025", prob:73.1, change:-1.7 },
  { label:"SOL top 3 by market cap", prob:44.2, change:+2.8 },
  { label:"Gold above $2,500/oz by Jun", prob:62.3, change:-0.9 },
];

function tc(tier: number) { return tier===90?'#0d9488':tier===70?'#d97706':'#ea580c'; }
function tl(d: number) { return d<=20?"This week":d<=50?"This month":"Long term"; }

// Logo asset paths - swap here if you rename files
const LOGO_SRC = {
  full:  "/senthos_full.png",
  teal:  "/senthos_teal.png",
  amber: "/senthos_amber.png",
  coral: "/senthos_coral.png",
};

// Lighter shade of a color for gradient
function lightenColor(hex: string, amount: number = 0.25): string {
  const h = hex.replace("#","");
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  const nr = Math.min(255, Math.round(r + (255-r)*amount));
  const ng = Math.min(255, Math.round(g + (255-g)*amount));
  const nb = Math.min(255, Math.round(b + (255-b)*amount));
  return `#${nr.toString(16).padStart(2,"0")}${ng.toString(16).padStart(2,"0")}${nb.toString(16).padStart(2,"0")}`;
}
function darkenColor(hex: string, amount: number = 0.2): string {
  const h = hex.replace("#","");
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  const nr = Math.max(0, Math.round(r * (1-amount)));
  const ng = Math.max(0, Math.round(g * (1-amount)));
  const nb = Math.max(0, Math.round(b * (1-amount)));
  return `#${nr.toString(16).padStart(2,"0")}${ng.toString(16).padStart(2,"0")}${nb.toString(16).padStart(2,"0")}`;
}

function Sparkline({ data, color, height=48, width=120 }: { data:number[], color:string, height?:number, width?:number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if(!c) return;
    const ctx = c.getContext("2d")!; const dpr = window.devicePixelRatio||1;
    c.width=width*dpr; c.height=height*dpr; c.style.width=width+"px"; c.style.height=height+"px";
    ctx.scale(dpr,dpr); ctx.clearRect(0,0,width,height);
    const min=Math.min(...data), max=Math.max(...data), range=max-min||0.01; const pad=3;
    const pts=data.map((v,i)=>({x:pad+(i/(data.length-1))*(width-pad*2),y:pad+(1-(v-min)/range)*(height-pad*2)}));
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++){const m={x:(pts[i-1].x+pts[i].x)/2,y:(pts[i-1].y+pts[i].y)/2};ctx.quadraticCurveTo(pts[i-1].x,pts[i-1].y,m.x,m.y);}
    ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
    ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.stroke();
    ctx.lineTo(pts[pts.length-1].x,height); ctx.lineTo(pts[0].x,height); ctx.closePath();
    ctx.fillStyle=color+"18"; ctx.fill();
  },[data,color,height,width]);
  return <canvas ref={ref} style={{display:"block",width:"100%",height:height+"px"}} />;
}

function NavChart({ data, color, tier }: { data:number[], color:string, tier:number }) {
  const ref = useRef<HTMLCanvasElement>(null); const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c=ref.current; if(!c||!wrap.current) return;
    const W=wrap.current.clientWidth||500, H=180; const dpr=window.devicePixelRatio||1;
    c.width=W*dpr; c.height=H*dpr; c.style.width=W+"px"; c.style.height=H+"px";
    const ctx=c.getContext("2d")!; ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
    const base=tier/100; const allD=[base,...data];
    const min=Math.min(...allD)-0.005, max=Math.max(...allD)+0.005, range=max-min;
    const pL=54,pR=16,pT=14,pB=28;
    const pts=data.map((v,i)=>({x:pL+(i/(data.length-1))*(W-pL-pR),y:pT+(1-(v-min)/range)*(H-pT-pB)}));
    const baseY=pT+(1-(base-min)/range)*(H-pT-pB);
    ctx.beginPath(); ctx.moveTo(pL,baseY); ctx.lineTo(W-pR,baseY);
    ctx.strokeStyle="#1a2a3a"; ctx.lineWidth=1; ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]);
    for(let i=0;i<=4;i++){
      const y=pT+(i/4)*(H-pT-pB);
      ctx.beginPath(); ctx.moveTo(pL,y); ctx.lineTo(W-pR,y); ctx.strokeStyle="#0f1a24"; ctx.lineWidth=0.5; ctx.stroke();
      ctx.fillStyle="#3a4f62"; ctx.font=`10px ${FS}`; ctx.textAlign="right";
      ctx.fillText("$"+(max-(i/4)*range).toFixed(3),pL-6,y+3);
    }
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++){const m={x:(pts[i-1].x+pts[i].x)/2,y:(pts[i-1].y+pts[i].y)/2};ctx.quadraticCurveTo(pts[i-1].x,pts[i-1].y,m.x,m.y);}
    ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
    ctx.lineTo(pts[pts.length-1].x,H-pB); ctx.lineTo(pts[0].x,H-pB); ctx.closePath();
    ctx.fillStyle=color+"18"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++){const m={x:(pts[i-1].x+pts[i].x)/2,y:(pts[i-1].y+pts[i].y)/2};ctx.quadraticCurveTo(pts[i-1].x,pts[i-1].y,m.x,m.y);}
    ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.stroke();
    const last=pts[pts.length-1];
    ctx.beginPath(); ctx.arc(last.x,last.y,3.5,0,2*Math.PI); ctx.fillStyle=color; ctx.fill();
    [["30d ago",0],["15d ago",0.5],["Now",1]].forEach(([l,t])=>{
      const x=pL+(t as number)*(W-pL-pR);
      ctx.fillStyle="#3a4f62"; ctx.font=`10px ${FS}`;
      ctx.textAlign=t===0?"left":t===1?"right":"center";
      ctx.fillText(l as string,x,H-8);
    });
  },[data,color,tier]);
  return <div ref={wrap} style={{width:"100%"}}><canvas ref={ref} /></div>;
}

// =========================================================================
// SVG DONUT - premium with gradients, inner shadows, frosted center
// =========================================================================
function polarToCartesian(cx:number, cy:number, r:number, angleRad:number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}
function arcPath(cx:number, cy:number, rOuter:number, rInner:number, startAngle:number, endAngle:number) {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const start = polarToCartesian(cx, cy, rOuter, startAngle);
  const end = polarToCartesian(cx, cy, rOuter, endAngle);
  const startIn = polarToCartesian(cx, cy, rInner, endAngle);
  const endIn = polarToCartesian(cx, cy, rInner, startAngle);
  return `M ${start.x} ${start.y} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${end.x} ${end.y} L ${startIn.x} ${startIn.y} A ${rInner} ${rInner} 0 ${largeArc} 0 ${endIn.x} ${endIn.y} Z`;
}

function SvgDonut({ data, size, activeId, onHover, isEmpty }: {
  data: {id:string, value:number, color:string}[],
  size: number,
  activeId: string | null,
  onHover: (id:string|null) => void,
  isEmpty?: boolean,
}) {
  const PAD = 32;
  const TOTAL = size + PAD*2;
  const cx = TOTAL/2, cy = TOTAL/2;
  const baseR = size * 0.355;
  const thickness = size * 0.11;
  const gap = 0.024;

  // Empty ghost ring
  if (isEmpty || data.length === 0) {
    return (
      <svg width={TOTAL} height={TOTAL} style={{display:"block", margin:`-${PAD}px`}}>
        <defs>
          <linearGradient id="emptyRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1a2330" />
            <stop offset="100%" stopColor="#0f1620" />
          </linearGradient>
          <filter id="emptyInset">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
            <feOffset dx="0" dy="1" result="offsetblur"/>
            <feComposite in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" result="shadow"/>
            <feColorMatrix in="shadow" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3 0"/>
            <feComposite in2="SourceGraphic" operator="in"/>
          </filter>
        </defs>
        <path
          d={arcPath(cx, cy, baseR+thickness, baseR, -Math.PI/2, Math.PI*1.5 - 0.0001)}
          fill="url(#emptyRing)"
          filter="url(#emptyInset)"
        />
      </svg>
    );
  }

  const total = data.reduce((s,d)=>s+d.value, 0);
  // Use a reducer so the cumulative angle is threaded through the
  // function-return path rather than mutating a closed-over local
  // (which the React-Compiler lint rule flags as state-after-render).
  const slices = data.reduce<Array<typeof data[number] & { start: number; end: number }>>(
    (acc, d) => {
      const prevEnd = acc.length > 0 ? acc[acc.length - 1].end : -Math.PI / 2;
      const angle = (d.value / total) * 2 * Math.PI;
      acc.push({ ...d, start: prevEnd, end: prevEnd + angle });
      return acc;
    },
    [],
  );

  return (
    <svg
      width={TOTAL}
      height={TOTAL}
      style={{display:"block", margin:`-${PAD}px`, cursor:"crosshair"}}
      onMouseLeave={()=>onHover(null)}
    >
      <defs>
        {/* Per-slice gradients */}
        {slices.map(s => (
          <linearGradient key={`grad-${s.id}`} id={`grad-${s.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={lightenColor(s.color, 0.22)} />
            <stop offset="50%" stopColor={s.color} />
            <stop offset="100%" stopColor={darkenColor(s.color, 0.18)} />
          </linearGradient>
        ))}
        {/* Inner shadow filter for depth */}
        <filter id="sliceShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
          <feOffset dx="0" dy="0.5" result="offsetblur"/>
          <feComposite in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" result="shadow"/>
          <feColorMatrix in="shadow" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.4 0"/>
          <feComposite in2="SourceGraphic" operator="over"/>
        </filter>
        {/* Active slice glow */}
        <filter id="activeGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        {/* Frosted inner circle */}
        <radialGradient id="innerFrost" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#1a2536" stopOpacity="1" />
          <stop offset="70%" stopColor={C.card} stopOpacity="1" />
          <stop offset="100%" stopColor="#0c131c" stopOpacity="1" />
        </radialGradient>
      </defs>

      {slices.map(s => {
        const isActive = activeId === s.id;
        const isNone = activeId === null;
        const midAngle = (s.start + s.end) / 2;
        const offsetDist = isActive ? 6 : 0;
        const ox = Math.cos(midAngle) * offsetDist;
        const oy = Math.sin(midAngle) * offsetDist;

        const outerR = baseR + thickness + (isActive ? 8 : 0);
        const innerR = baseR - (isActive ? 1 : 0);
        const adjStart = s.start + gap/2;
        const adjEnd = s.end - gap/2;

        return (
          <g
            key={s.id}
            transform={`translate(${ox} ${oy})`}
            style={{
              opacity: isNone ? 1 : isActive ? 1 : 0.18,
              transition: `opacity 0.35s ${EASE}, transform 0.4s ${EASE}`,
              cursor: "pointer",
            }}
            onMouseEnter={()=>onHover(s.id)}
          >
            {isActive && (
              <path
                d={arcPath(cx, cy, outerR + 4, outerR - 2, adjStart, adjEnd)}
                fill={s.color}
                opacity="0.25"
                filter="url(#activeGlow)"
              />
            )}
            <path
              d={arcPath(cx, cy, outerR, innerR, adjStart, adjEnd)}
              fill={`url(#grad-${s.id})`}
              filter="url(#sliceShadow)"
              style={{ transition: `d 0.4s ${EASE}` }}
            />
            {/* Specular highlight - thin bright arc on the outer edge */}
            <path
              d={arcPath(cx, cy, outerR, outerR - 2, adjStart, adjEnd)}
              fill={lightenColor(s.color, 0.45)}
              opacity="0.5"
            />
          </g>
        );
      })}

      {/* Frosted inner disc */}
      <circle cx={cx} cy={cy} r={baseR - 1} fill="url(#innerFrost)" />
      {/* Subtle inner rim */}
      <circle cx={cx} cy={cy} r={baseR - 1} fill="none" stroke={C.border} strokeWidth="0.5" opacity="0.6" />
    </svg>
  );
}

function NavItem({ label, active, onClick }: { label:string, active:boolean, onClick:()=>void }) {
  return (
    <button onClick={onClick} style={{ display:"flex",alignItems:"center",width:"100%",padding:"9px 14px",borderRadius:8,border:"none",cursor:"pointer", background:active?C.tealBg:"transparent",color:active?C.teal:C.textSecondary,fontSize:13,fontWeight:active?500:400,fontFamily:FS,transition:`all 0.2s ${EASE}`,textAlign:"left",borderLeft:active?`2px solid ${C.teal}`:"2px solid transparent" }}
      onMouseEnter={e=>{if(!active)(e.currentTarget as HTMLElement).style.background=C.surface;}}
      onMouseLeave={e=>{if(!active)(e.currentTarget as HTMLElement).style.background="transparent";}}
    >{label}</button>
  );
}

function BundleCard({ bundle, onClick }: { bundle:Bundle, onClick:()=>void }) {
  const [hov,setHov]=useState(false); const color=tc(bundle.tier);
  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{
      background: hov ? C.cardGradientHover : C.cardGradient,
      border:`0.5px solid ${hov ? color+"50" : C.border}`,
      borderRadius:16,padding:"18px 20px 14px",cursor:"pointer",
      transition:`all 0.3s ${EASE}`,position:"relative",overflow:"hidden",
      transform: hov ? "translateY(-2px)" : "translateY(0)",
      boxShadow: hov ? `0 12px 32px rgba(0,0,0,0.4), 0 0 24px ${color}18` : "0 4px 14px rgba(0,0,0,0.2)",
      backdropFilter:"blur(10px)",
    }}>
      {/* Top accent ribbon */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:color,opacity: hov ? 1 : 0.75}} />
      {/* Corner radial glow */}
      <div style={{position:"absolute",top:-60,right:-60,width:180,height:180,background:`radial-gradient(circle, ${color}20 0%, transparent 65%)`,pointerEvents:"none",opacity: hov ? 1 : 0.45,transition:`opacity 0.3s ${EASE}`}} />
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,position:"relative"}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:C.textPrimary,fontFamily:FD,marginBottom:4,letterSpacing:"0.01em"}}>{bundle.id}</div>
          <div style={{fontSize:11,color:C.textMuted,fontFamily:FM,letterSpacing:"0.04em"}}>{bundle.resolved}/{bundle.totalLegs} resolved · {bundle.daysLeft}d left</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:26,fontWeight:300,color,fontFamily:FD,lineHeight:1,letterSpacing:"-0.02em"}}>{(bundle.nav*100).toFixed(1)}%</div>
          <div style={{fontSize:11,color:C.textSecondary,fontFamily:FM,marginTop:3}}>${bundle.nav.toFixed(3)}</div>
        </div>
      </div>
      <div style={{marginBottom:10,height:44,position:"relative"}}><Sparkline data={bundle.history} color={color} height={44} width={300} /></div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontFamily:FM,letterSpacing:"0.02em",position:"relative"}}>
        <span style={{color:bundle.change>=0?C.green:C.red,fontWeight:500}}>{bundle.change>=0?"+":""}{bundle.change.toFixed(1)}% today</span>
        <span style={{color:C.textMuted}}>Resolves {bundle.date}</span>
      </div>
    </div>
  );
}

function MoverRow({ bundle, rank, onClick, isPositive }: { bundle:Bundle, rank:number, onClick:()=>void, isPositive:boolean }) {
  const color=tc(bundle.tier); const cc=isPositive?C.green:C.red;
  return (
    <div onClick={onClick} style={{
      display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:12,cursor:"pointer",
      transition:`all 0.3s ${EASE}`,
      background:C.cardGradient,
      border:`0.5px solid rgba(255, 255, 255, 0.05)`,
      borderLeft:`2px solid ${color}`,
      position:"relative",overflow:"hidden",
      backdropFilter:"blur(10px)",
    }}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=cc+"40";e.currentTarget.style.borderLeftColor=color;e.currentTarget.style.transform="translateX(2px)";e.currentTarget.style.boxShadow=`0 0 16px ${cc}15`;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.borderLeftColor=color;e.currentTarget.style.transform="translateX(0)";e.currentTarget.style.boxShadow="none";}}>
      <div style={{fontSize:16,fontWeight:300,color:C.textMuted,fontFamily:FD,width:20}}>{rank}</div>
      <div style={{flex:1}}>
        <div style={{fontSize:13,fontWeight:500,color:C.textPrimary,fontFamily:FD,letterSpacing:"0.01em"}}>{bundle.id}</div>
        <div style={{fontSize:11,color:C.textMuted,fontFamily:FM,marginTop:2,letterSpacing:"0.02em"}}>{bundle.daysLeft}d · {bundle.resolved}/{bundle.totalLegs} resolved</div>
      </div>
      <div style={{width:64}}><Sparkline data={bundle.history} color={cc} height={30} width={64} /></div>
      <div style={{textAlign:"right",minWidth:70}}>
        <div style={{fontSize:15,fontWeight:500,color,fontFamily:FD,letterSpacing:"-0.01em"}}>{(bundle.nav*100).toFixed(1)}%</div>
        <div style={{fontSize:11,color:cc,fontFamily:FM,fontWeight:500}}>{isPositive?"+":""}{bundle.change.toFixed(1)}%</div>
      </div>
    </div>
  );
}

function Ticker() {
  const items = [...BUNDLES, ...BUNDLES];
  return (
    <div style={{
      overflow:"hidden",position:"relative",borderRadius:14,
      background:C.cardGradient,
      border:`0.5px solid rgba(45, 212, 191, 0.1)`,
      marginBottom:28,
      backdropFilter:"blur(10px)",
    }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(to right, transparent, ${C.tealLight}33, transparent)`,zIndex:3}} />
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:80,background:`linear-gradient(to right, ${C.edgeFade}, transparent)`,zIndex:2,pointerEvents:"none"}} />
      <div style={{position:"absolute",right:0,top:0,bottom:0,width:80,background:`linear-gradient(to left, ${C.edgeFade}, transparent)`,zIndex:2,pointerEvents:"none"}} />
      <div style={{display:"flex",gap:0,whiteSpace:"nowrap",animation:"tickerScroll 60s linear infinite"}}>
        {items.map((b,i)=>(
          <div key={`${b.id}-${i}`} style={{display:"flex",alignItems:"center",gap:10,padding:"14px 22px",borderRight:`0.5px solid rgba(255, 255, 255, 0.04)`,flexShrink:0}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:tc(b.tier),boxShadow:`0 0 8px ${tc(b.tier)}`}} />
            <span style={{fontSize:11,fontWeight:500,color:C.textPrimary,fontFamily:FD,letterSpacing:"0.04em"}}>{b.id}</span>
            <span style={{fontSize:11,color:C.textSecondary,fontFamily:FM}}>${b.nav.toFixed(3)}</span>
            <span style={{fontSize:11,fontWeight:500,color:b.change>=0?C.green:C.red,fontFamily:FM}}>
              {b.change>=0?"▲":"▼"} {Math.abs(b.change).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturedHero({ bundle, onClick }: { bundle:Bundle, onClick:()=>void }) {
  const isMobile = useMobile();
  const color = tc(bundle.tier);
  return (
    <div onClick={onClick} style={{
      background: C.cardGradientStrong,
      border:`0.5px solid rgba(45, 212, 191, 0.12)`,
      borderRadius:20,
      padding: isMobile ? "22px 20px" : "32px 36px",
      cursor:"pointer",
      position:"relative",
      overflow:"hidden",
      transition:`all 0.4s ${EASE}`,
      marginBottom:28,
      backdropFilter:"blur(12px)",
    }}
    onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.borderColor=color+"40";e.currentTarget.style.boxShadow=`0 20px 50px rgba(0,0,0,0.4), 0 0 40px ${color}15`;}}
    onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.borderColor="rgba(45, 212, 191, 0.12)";e.currentTarget.style.boxShadow="none";}}
    >
      {/* Top accent ribbon */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(to right, transparent, ${color}, transparent)`,opacity:0.7}} />
      {/* Corner radial glow */}
      <div style={{position:"absolute",top:-120,right:-120,width:460,height:460,background:`radial-gradient(circle, ${color}22 0%, transparent 60%)`,pointerEvents:"none"}} />
      {/* Decorative orbital ring */}
      {!isMobile && (
        <>
          <div style={{position:"absolute",top:"50%",right:-180,width:420,height:420,marginTop:-210,borderRadius:"50%",border:`0.5px solid ${color}22`,pointerEvents:"none"}} />
          <div style={{position:"absolute",top:"50%",right:-80,width:220,height:220,marginTop:-110,borderRadius:"50%",border:`0.5px solid ${color}44`,pointerEvents:"none",boxShadow:`0 0 40px ${color}15`}} />
        </>
      )}
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1.3fr",gap:isMobile?16:36,position:"relative",zIndex:1,alignItems:"center"}}>
        <div>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:100,background:color+"15",border:`0.5px solid ${color}40`,marginBottom:14,backdropFilter:"blur(8px)"}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}`}} />
            <span style={{fontSize:10,color,fontFamily:FM,fontWeight:500,letterSpacing:"0.16em"}}>FEATURED · {bundle.tier}% TIER</span>
          </div>
          <div style={{fontSize:isMobile?22:32,fontWeight:300,color:C.textPrimary,fontFamily:FD,marginBottom:6,letterSpacing:"-0.02em"}}>{bundle.id}</div>
          <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS,marginBottom:18}}>
            {bundle.resolved}/{bundle.totalLegs} legs resolved · Resolves {bundle.date}
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:14,marginBottom:14}}>
            <div style={{fontSize:isMobile?36:54,fontWeight:200,color,fontFamily:FD,lineHeight:1,letterSpacing:"-0.03em"}}>{(bundle.nav*100).toFixed(1)}%</div>
            <div>
              <div style={{fontSize:13,color:C.textSecondary,fontFamily:FM,letterSpacing:"0.02em"}}>${bundle.nav.toFixed(3)}</div>
              <div style={{fontSize:12,fontWeight:500,color:bundle.change>=0?C.green:C.red,fontFamily:FM,marginTop:3,letterSpacing:"0.02em"}}>
                {bundle.change>=0?"+":""}{bundle.change.toFixed(2)}% today
              </div>
            </div>
          </div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,color,fontFamily:FD,fontWeight:500,letterSpacing:"0.02em"}}>
            View constellation →
          </div>
        </div>
        {!isMobile && (
          <div style={{height:160,position:"relative"}}>
            <Sparkline data={bundle.history} color={color} height={160} width={500} />
          </div>
        )}
      </div>
    </div>
  );
}

function PulseGauge({ prob, color, size=56 }: { prob:number, color:string, size?:number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if(!c) return;
    const dpr = window.devicePixelRatio||1;
    c.width=size*dpr; c.height=size*dpr; c.style.width=size+"px"; c.style.height=size+"px";
    const ctx = c.getContext("2d")!; ctx.scale(dpr,dpr);
    const cx=size/2, cy=size/2, r=size/2-4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI*0.75, Math.PI*2.25);
    ctx.lineWidth=4; ctx.strokeStyle=C.border; ctx.lineCap="round"; ctx.stroke();
    const endAngle = Math.PI*0.75 + (prob/100)*Math.PI*1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI*0.75, endAngle);
    ctx.lineWidth=4; ctx.strokeStyle=color; ctx.lineCap="round"; ctx.stroke();
  }, [prob, color, size]);
  return <canvas ref={ref} style={{display:"block"}} />;
}

function MarketsPage({ onSelect }: { onSelect:(b:Bundle,from:string)=>void }) {
  const isMobile = useMobile();
  const sorted=[...BUNDLES].sort((a,b)=>b.change-a.change);
  const gainers=sorted.slice(0,3); const losers=[...sorted].reverse().slice(0,3);
  const featured = sorted[0];

  return (
    <div>
      {/* Orbital page header */}
      <div style={{marginBottom:28,position:"relative",padding:isMobile?"8px 0 18px":"4px 0 22px",borderBottom:`0.5px solid rgba(45, 212, 191, 0.1)`}}>
        <div style={{position:"absolute",top:0,right:0,width:220,height:140,background:`radial-gradient(ellipse at top right, rgba(45, 212, 191, 0.12) 0%, transparent 70%)`,pointerEvents:"none"}} />
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,position:"relative"}}>
          <span style={{width:18,height:1,background:C.tealLight,opacity:0.6}} />
          <span style={{fontFamily:FM,fontSize:10,letterSpacing:"0.22em",color:C.tealLight,fontWeight:500}}>MARKETS</span>
          <span style={{width:18,height:1,background:C.tealLight,opacity:0.6}} />
        </div>
        <div style={{fontSize:isMobile?26:32,fontWeight:200,color:C.textPrimary,fontFamily:FD,marginBottom:6,letterSpacing:"-0.02em",position:"relative"}}>The <span style={{fontWeight:500,background:`linear-gradient(90deg, ${C.tealLight} 0%, #a5f3fc 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>live sky</span></div>
        <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS,position:"relative"}}>{BUNDLES.length} active constellations · live NAV</div>
      </div>
      <Ticker />
      <FeaturedHero bundle={featured} onClick={()=>onSelect(featured,"markets")} />
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:20,marginBottom:36}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <span style={{width:16,height:1,background:C.green,opacity:0.5}} />
            <span style={{fontSize:10,color:C.green,fontFamily:FM,fontWeight:500,letterSpacing:"0.2em"}}>TOP GAINERS</span>
            <span style={{flex:1,height:1,background:`linear-gradient(to right, ${C.green}22, transparent)`}} />
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {gainers.map((b,i)=><MoverRow key={b.id} bundle={b} rank={i+1} isPositive={true} onClick={()=>onSelect(b,"markets")} />)}
          </div>
        </div>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,marginTop:isMobile?16:0}}>
            <span style={{width:16,height:1,background:C.red,opacity:0.5}} />
            <span style={{fontSize:10,color:C.red,fontFamily:FM,fontWeight:500,letterSpacing:"0.2em"}}>TOP LOSERS</span>
            <span style={{flex:1,height:1,background:`linear-gradient(to right, ${C.red}22, transparent)`}} />
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {losers.map((b,i)=><MoverRow key={b.id} bundle={b} rank={i+1} isPositive={false} onClick={()=>onSelect(b,"markets")} />)}
          </div>
        </div>
      </div>
      <div style={{marginBottom:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:16,height:1,background:C.textMuted,opacity:0.6}} />
            <span style={{fontSize:10,color:C.textMuted,fontFamily:FM,fontWeight:500,letterSpacing:"0.22em"}}>PREDICTION MARKET PULSE</span>
          </div>
          {!isMobile && <div style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.12em"}}>UNDERLYING · LIVE</div>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3, 1fr)",gap:10}}>
          {HOT_PREDICTIONS.map((p,i)=>{
            const color = p.prob>70?C.teal:p.prob>50?C.amber:C.coral;
            return (
              <div key={i} style={{
                background:C.cardGradient,
                border:`0.5px solid rgba(255, 255, 255, 0.06)`,
                borderRadius:14,padding:isMobile?"12px 14px":"16px 18px",
                display:"flex",alignItems:"center",gap:isMobile?10:14,
                transition:`all 0.3s ${EASE}`,position:"relative",overflow:"hidden",
                backdropFilter:"blur(10px)",
              }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=color+"40";e.currentTarget.style.boxShadow=`0 0 18px ${color}12`;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow="none";}}
              >
                <PulseGauge prob={p.prob} color={color} size={isMobile?44:56} />
                <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                  <div style={{fontSize:isMobile?11:12,color:C.textPrimary,fontFamily:FS,marginBottom:4,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{p.label}</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                    <span style={{fontSize:isMobile?15:18,fontWeight:500,color:C.textPrimary,fontFamily:FD,letterSpacing:"-0.01em"}}>{p.prob}%</span>
                    <span style={{fontSize:11,color:p.change>=0?C.green:C.red,fontFamily:FM,fontWeight:500}}>
                      {p.change>=0?"+":""}{p.change.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <span style={{width:16,height:1,background:C.textMuted,opacity:0.6}} />
          <span style={{fontSize:10,color:C.textMuted,fontFamily:FM,fontWeight:500,letterSpacing:"0.22em"}}>LATEST NEWS</span>
          <span style={{flex:1,height:1,background:`linear-gradient(to right, ${C.textMuted}22, transparent)`}} />
        </div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(3, 1fr)",gap:10}}>
          {NEWS.slice(0,isMobile?4:6).map((n,i)=>{
            const impactColor = n.impact==="positive"?C.green:n.impact==="negative"?C.red:C.textMuted;
            return (
              <div key={i} style={{
                background:C.cardGradient,
                border:`0.5px solid rgba(255, 255, 255, 0.05)`,
                borderRadius:12,padding:"12px 14px",
                borderLeft:`2px solid ${impactColor}`,
                transition:`all 0.3s ${EASE}`,position:"relative",overflow:"hidden",
                backdropFilter:"blur(10px)",
              }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=`rgba(45, 212, 191, 0.25)`;e.currentTarget.style.borderLeftColor=impactColor;e.currentTarget.style.transform="translateX(2px)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.borderLeftColor=impactColor;e.currentTarget.style.transform="translateX(0)";}}
              >
                <div style={{fontSize:12,color:C.textPrimary,fontFamily:FS,lineHeight:1.4,marginBottom:8,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{n.headline}</div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.04em"}}>
                  <span>{n.source}</span><span>{n.time}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type TimeFilter="week"|"month"|"long";
type SortOption="change_desc"|"change_asc"|"nav_desc"|"nav_asc"|"days_asc";

function ConstellationsPage({ onSelect }: { onSelect:(b:Bundle,from:string)=>void }) {
  const [tier,setTier]=useState<90|70|50>(90);
  const [time,setTime]=useState<TimeFilter>("week");
  const [sort,setSort]=useState<SortOption>("change_desc");
  const timeMap:Record<TimeFilter,string>={week:"This week",month:"This month",long:"Long term"};
  const sortMap:Record<SortOption,string>={change_desc:"Top gainers",change_asc:"Top losers",nav_desc:"Highest prob",nav_asc:"Lowest prob",days_asc:"Expiring soon"};
  const filtered=BUNDLES.filter(b=>b.tier===tier&&tl(b.daysLeft)===timeMap[time]).sort((a,b)=>{
    if(sort==="change_desc") return b.change-a.change;
    if(sort==="change_asc") return a.change-b.change;
    if(sort==="nav_desc") return b.nav-a.nav;
    if(sort==="nav_asc") return a.nav-b.nav;
    return a.daysLeft-b.daysLeft;
  });
  const Pill=({children,active,onClick,color}:{children:React.ReactNode,active:boolean,onClick:()=>void,color?:string})=>(
    <button onClick={onClick} style={{
      padding:"7px 16px",borderRadius:100,
      border:`0.5px solid ${active?(color||C.tealLight):C.border}`,
      background:active?`${color||C.tealLight}15`:C.surface,
      color:active?(color||C.tealLight):C.textSecondary,
      fontSize:12,fontFamily:FD,cursor:"pointer",
      transition:`all 0.2s ${EASE}`,
      fontWeight:active?500:400,
      boxShadow:active?`0 0 16px ${color||C.tealLight}20`:"none",
      letterSpacing:"0.01em",
    }}
      onMouseEnter={e=>{if(!active){(e.currentTarget as HTMLElement).style.borderColor="rgba(45, 212, 191, 0.2)";(e.currentTarget as HTMLElement).style.color=C.textPrimary;}}}
      onMouseLeave={e=>{if(!active){(e.currentTarget as HTMLElement).style.borderColor=C.border;(e.currentTarget as HTMLElement).style.color=C.textSecondary;}}}
    >{children}</button>
  );
  return (
    <div>
      {/* Orbital page header */}
      <div style={{marginBottom:24,position:"relative",padding:"4px 0 22px",borderBottom:`0.5px solid rgba(45, 212, 191, 0.1)`}}>
        <div style={{position:"absolute",top:0,right:0,width:220,height:140,background:`radial-gradient(ellipse at top right, rgba(217, 119, 6, 0.12) 0%, transparent 70%)`,pointerEvents:"none"}} />
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,position:"relative"}}>
          <span style={{width:18,height:1,background:C.amber,opacity:0.7}} />
          <span style={{fontFamily:FM,fontSize:10,letterSpacing:"0.22em",color:"#fbbf24",fontWeight:500}}>CONSTELLATIONS</span>
          <span style={{width:18,height:1,background:C.amber,opacity:0.7}} />
        </div>
        <div style={{fontSize:32,fontWeight:200,color:C.textPrimary,fontFamily:FD,marginBottom:6,letterSpacing:"-0.02em",position:"relative"}}>Pick your <span style={{fontWeight:500,background:`linear-gradient(90deg, #fbbf24 0%, #fb923c 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>orbit</span></div>
        <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS,position:"relative"}}>Browse and filter all available structured constellations</div>
      </div>
      <div style={{
        background:C.cardGradient,
        border:`0.5px solid rgba(45, 212, 191, 0.1)`,
        borderRadius:18,
        padding:"20px 22px",
        marginBottom:22,
        position:"relative",
        overflow:"hidden",
        backdropFilter:"blur(12px)",
      }}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(to right, transparent, ${C.tealLight}44, transparent)`}} />
        <div style={{position:"absolute",top:-40,left:-40,width:160,height:160,background:`radial-gradient(circle, rgba(45, 212, 191, 0.08) 0%, transparent 70%)`,pointerEvents:"none"}} />
        <div style={{display:"flex",flexDirection:"column",gap:16,position:"relative"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{width:3,height:3,borderRadius:"50%",background:C.tealLight,boxShadow:`0 0 6px ${C.tealLight}`}} />
              <span style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.18em",fontWeight:500}}>PROBABILITY TIER</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              {([90,70,50] as const).map(t=><Pill key={t} active={tier===t} onClick={()=>setTier(t)} color={tc(t)}>{t}%</Pill>)}
            </div>
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{width:3,height:3,borderRadius:"50%",background:C.tealLight,boxShadow:`0 0 6px ${C.tealLight}`}} />
              <span style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.18em",fontWeight:500}}>RESOLUTION WINDOW</span>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {(["week","month","long"] as TimeFilter[]).map(t=><Pill key={t} active={time===t} onClick={()=>setTime(t)}>{timeMap[t]}</Pill>)}
            </div>
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{width:3,height:3,borderRadius:"50%",background:C.tealLight,boxShadow:`0 0 6px ${C.tealLight}`}} />
              <span style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.18em",fontWeight:500}}>SORT BY</span>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {(Object.keys(sortMap) as SortOption[]).map(s=><Pill key={s} active={sort===s} onClick={()=>setSort(s)}>{sortMap[s]}</Pill>)}
            </div>
          </div>
        </div>
      </div>
      {filtered.length===0?(
        <div style={{textAlign:"center",color:C.textMuted,padding:"60px 0",fontSize:14,fontFamily:FS}}>No constellations match these filters</div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(300px,1fr))",gap:14}}>
          {filtered.map(b=><BundleCard key={b.id} bundle={b} onClick={()=>onSelect(b,"constellations")} />)}
        </div>
      )}
    </div>
  );
}

function DetailPage({ bundle, fromTab, onBack, demoMode, demoUsdc, onDemoDeposit, onDemoPpnDeposit }: {
  bundle:Bundle, fromTab:string, onBack:()=>void,
  demoMode:boolean, demoUsdc:number,
  onDemoDeposit:(bundleId:string, usdcAmount:number) => void,
  onDemoPpnDeposit:(bundleId:string, usdcAmount:number) => void,
}) {
  const isMobile = useMobile();
  const [usdcAmt,setUsdcAmt]=useState("");
  const [ppnMode,setPpnMode]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [flash,setFlash]=useState(false);
  const color=tc(bundle.tier);
  const dep=parseFloat(usdcAmt)||0;
  const tokensOut=dep>0?((dep*0.995)/bundle.nav).toFixed(2):"-";
  const apy=8.4;
  const vaultSplit=0.93; const basketSplit=0.07;
  const vaultAmt=dep*vaultSplit; const basketAmt=dep*basketSplit;
  const tokensFromBasket=dep>0?(basketAmt*0.995/bundle.nav):0;
  const worstCase=vaultAmt; const bestCase=vaultAmt+tokensFromBasket;

  const insufficient = demoMode && dep > demoUsdc;

  const handleConfirm = () => {
    if (!demoMode) { setConfirmed(true); return; }
    if (dep <= 0 || insufficient) return;
    if (ppnMode) onDemoPpnDeposit(bundle.id, dep);
    else onDemoDeposit(bundle.id, dep);
    setConfirmed(true);
    setFlash(true);
    setTimeout(()=>setFlash(false), 900);
    setTimeout(()=>{ setUsdcAmt(""); setConfirmed(false); }, 1500);
  };

  return (
    <div>
      <button onClick={onBack} style={{
        background:C.surface,
        border:`0.5px solid rgba(255, 255, 255, 0.06)`,
        borderRadius:100,
        color:C.textSecondary,cursor:"pointer",fontSize:12,marginBottom:22,
        padding:"7px 14px 7px 12px",fontFamily:FD,letterSpacing:"0.02em",
        display:"flex",alignItems:"center",gap:8,
        transition:`all 0.25s ${EASE}`,backdropFilter:"blur(8px)",
      }}
        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color=C.tealLight;(e.currentTarget as HTMLElement).style.borderColor="rgba(45, 212, 191, 0.3)";(e.currentTarget as HTMLElement).style.background="rgba(45, 212, 191, 0.06)";}}
        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color=C.textSecondary;(e.currentTarget as HTMLElement).style.borderColor=C.border;(e.currentTarget as HTMLElement).style.background=C.surface;}}
      >
        <span style={{fontSize:14,lineHeight:1}}>←</span>
        <span>Back to {fromTab==="constellations"?"Constellations":fromTab==="portfolio"?"Portfolio":"Markets"}</span>
      </button>

      {/* Orbital header block */}
      <div style={{
        position:"relative",marginBottom:24,padding:isMobile?"18px 0 22px":"8px 0 26px",
        borderBottom:`0.5px solid rgba(45, 212, 191, 0.1)`,
      }}>
        <div style={{position:"absolute",top:-40,right:-40,width:300,height:200,background:`radial-gradient(ellipse, ${color}22 0%, transparent 70%)`,pointerEvents:"none"}} />
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,position:"relative"}}>
          <span style={{width:16,height:1,background:color,opacity:0.7}} />
          <span style={{fontFamily:FM,fontSize:10,letterSpacing:"0.22em",color,fontWeight:500}}>{bundle.tier}% TIER · STHS-{bundle.tier}</span>
          <span style={{flex:1,height:1,background:`linear-gradient(to right, ${color}33, transparent)`}} />
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:isMobile?"flex-start":"flex-end",gap:20,position:"relative",flexDirection:isMobile?"column":"row"}}>
          <div>
            <div style={{fontSize:isMobile?28:36,fontWeight:200,color:C.textPrimary,fontFamily:FD,marginBottom:6,letterSpacing:"-0.025em"}}>{bundle.id}</div>
            <div style={{display:"flex",gap:12,fontSize:12,color:C.textSecondary,fontFamily:FM,letterSpacing:"0.02em",flexWrap:"wrap"}}>
              <span>{bundle.resolved}/{bundle.totalLegs} legs resolved</span>
              <span style={{color:C.textMuted}}>·</span><span>{bundle.daysLeft} days remaining</span>
              <span style={{color:C.textMuted}}>·</span><span>Resolves {bundle.date}</span>
            </div>
          </div>
          <div style={{textAlign:isMobile?"left":"right"}}>
            <div style={{fontSize:isMobile?40:52,fontWeight:200,color,fontFamily:FD,lineHeight:1,letterSpacing:"-0.03em"}}>{(bundle.nav*100).toFixed(1)}%</div>
            <div style={{fontSize:12,fontFamily:FM,marginTop:5,letterSpacing:"0.02em"}}>
              <span style={{color:C.textSecondary}}>${bundle.nav.toFixed(3)} · </span>
              <span style={{color:bundle.change>=0?C.green:C.red,fontWeight:500}}>{bundle.change>=0?"+":""}{bundle.change.toFixed(1)}% today</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 300px",gap:20}}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{
            background: C.cardGradient,
            border:`0.5px solid rgba(45, 212, 191, 0.1)`,
            borderRadius:16,padding:"22px 22px 18px",position:"relative",overflow:"hidden",
            backdropFilter:"blur(10px)",
          }}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(to right, transparent, ${color}55, transparent)`}} />
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,position:"relative"}}>
              <span style={{width:14,height:1,background:C.textMuted,opacity:0.6}} />
              <span style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.22em",fontWeight:500}}>NAV HISTORY · 30D</span>
              <span style={{flex:1,height:1,background:`linear-gradient(to right, ${C.textMuted}22, transparent)`}} />
            </div>
            <NavChart data={bundle.history} color={color} tier={bundle.tier} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:10}}>
            {[["Issue price",`$${bundle.issue.toFixed(2)}`],["Current NAV",`$${bundle.nav.toFixed(3)}`],["Legs resolved",`${bundle.resolved}/${bundle.totalLegs}`],["Days left",`${bundle.daysLeft}d`]].map(([k,v])=>(
              <div key={k} style={{
                background:C.cardGradient,
                border:`0.5px solid rgba(255, 255, 255, 0.06)`,
                borderRadius:12,padding:"14px 16px",position:"relative",overflow:"hidden",
                backdropFilter:"blur(8px)",
              }}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(to right, transparent, ${color}44, transparent)`,opacity:0.5}} />
                <div style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.12em",marginBottom:6}}>{k}</div>
                <div style={{fontSize:18,fontWeight:400,color:C.textPrimary,fontFamily:FD,letterSpacing:"-0.01em"}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{
            background:C.cardGradient,
            border:`0.5px solid rgba(255, 255, 255, 0.06)`,
            borderRadius:14,padding:"16px 20px",position:"relative",overflow:"hidden",
            backdropFilter:"blur(8px)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <span style={{width:14,height:1,background:C.textMuted,opacity:0.6}} />
              <span style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.22em",fontWeight:500}}>RESOLUTION PROGRESS</span>
            </div>
            <div style={{height:6,background:C.border,borderRadius:3,overflow:"hidden",marginBottom:8,position:"relative"}}>
              <div style={{width:`${Math.max(4,100-(bundle.daysLeft/180)*100)}%`,height:"100%",background:`linear-gradient(to right, ${color}, ${color}cc)`,borderRadius:3,boxShadow:`0 0 10px ${color}66`}} />
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.textMuted,fontFamily:FM,letterSpacing:"0.02em"}}>
              <span>Issued</span><span style={{color:C.textSecondary}}>Resolves {bundle.date}</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{
            background:C.cardGradientStrong,
            border:`0.5px solid ${flash?C.green:"rgba(45, 212, 191, 0.12)"}`,
            borderRadius:16,padding:22,position:"relative",overflow:"hidden",
            boxShadow:flash?`0 0 0 1px ${C.green}, 0 0 40px ${C.green}40`:`0 8px 24px rgba(0,0,0,0.25)`,
            transition:`all 0.4s ${EASE}`,backdropFilter:"blur(12px)",
          }}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:ppnMode?`linear-gradient(to right, ${C.teal}, ${C.tealLight})`:color,opacity:0.8}} />
            <div style={{position:"absolute",top:-60,right:-60,width:180,height:180,background:`radial-gradient(circle, ${ppnMode?C.teal:color}18 0%, transparent 65%)`,pointerEvents:"none"}} />
            <div style={{fontSize:14,fontWeight:500,color:C.textPrimary,fontFamily:FD,marginBottom:demoMode?6:16,letterSpacing:"-0.005em",position:"relative"}}>{ppnMode?"Principal Protection":"Deposit USDC"}</div>
            {demoMode && (
              <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,marginBottom:12,letterSpacing:"0.04em"}}>
                DEMO BALANCE · <span style={{color:C.teal}}>${demoUsdc.toFixed(0)}</span> USDC
              </div>
            )}
            <input type="number" placeholder="0.00" value={usdcAmt} onChange={e=>{setUsdcAmt(e.target.value);setConfirmed(false);setPpnMode(false);}}
              style={{width:"100%",background:C.surface,border:`0.5px solid ${insufficient?C.red:C.border}`,borderRadius:10,padding:"12px 14px",color:C.textPrimary,fontSize:22,fontWeight:700,fontFamily:FD,boxSizing:"border-box",marginBottom:insufficient?6:14,outline:"none"}} />
            {insufficient && <div style={{fontSize:11,color:C.red,fontFamily:FS,marginBottom:10}}>Insufficient balance</div>}
            {!ppnMode?(
              <>
                <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                  {[["Tokens received",tokensOut,C.textPrimary],["Entry probability",`${(bundle.nav*100).toFixed(1)}%`,color],["Max payout",dep>0?`$${(dep*0.995/bundle.nav).toFixed(0)}`:"-",C.green]].map(([k,v,c])=>(
                    <div key={k as string} style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:FS,marginBottom:8}}>
                      <span style={{color:C.textSecondary}}>{k as string}</span>
                      <span style={{color:c as string,fontFamily:FD,fontWeight:600}}>{v as string}</span>
                    </div>
                  ))}
                </div>
                <button onClick={handleConfirm} disabled={insufficient || dep<=0} style={{width:"100%",padding:"12px 0",borderRadius:10,border:"none",background:confirmed?C.green:(insufficient||dep<=0)?C.border:color,color:(insufficient||dep<=0)?C.textMuted:"#000",fontSize:14,fontWeight:700,fontFamily:FD,cursor:(insufficient||dep<=0)?"not-allowed":"pointer",marginBottom:8,transition:`all 0.25s ${EASE}`,opacity:(insufficient||dep<=0)?0.7:1}}>
                  {confirmed?"✓ Confirmed":demoMode?"Buy tokens":"Confirm deposit"}
                </button>
                {dep>0&&!insufficient&&(
                  <button onClick={()=>setPpnMode(true)} style={{width:"100%",padding:"10px 0",borderRadius:10,border:`0.5px solid ${C.teal}`,background:C.tealBg,color:C.teal,fontSize:13,fontWeight:600,fontFamily:FD,cursor:"pointer",transition:`all 0.2s ${EASE}`}}>
                    Execute principal protection
                  </button>
                )}
              </>
            ):(
              <>
                {dep>0&&(
                  <div style={{marginBottom:14}}>
                    <div style={{display:"flex",height:6,borderRadius:3,overflow:"hidden",marginBottom:6}}>
                      <div style={{width:"93%",background:C.teal,borderRadius:"3px 0 0 3px"}} />
                      <div style={{width:"7%",background:color,borderRadius:"0 3px 3px 0"}} />
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.textMuted,fontFamily:FS}}>
                      <span style={{color:C.teal}}>93% vault · ${vaultAmt.toFixed(0)}</span>
                      <span style={{color}}>7% basket · ${basketAmt.toFixed(0)}</span>
                    </div>
                  </div>
                )}
                <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:FS,marginBottom:10,paddingBottom:10,borderBottom:`0.5px solid ${C.border}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:7,height:7,borderRadius:2,background:C.teal}} />
                      <span style={{color:C.textSecondary}}>Meteora vault</span>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:C.textPrimary,fontWeight:500,fontFamily:FS}}>{dep>0?`$${vaultAmt.toFixed(0)}`:"-"}</div>
                      <div style={{fontSize:10,color:C.teal,marginTop:1}}>{apy}% APY · redeemable anytime</div>
                    </div>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:FS}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:7,height:7,borderRadius:2,background:color}} />
                      <span style={{color:C.textSecondary}}>{bundle.id}</span>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:C.textPrimary,fontWeight:500,fontFamily:FS}}>{dep>0?`$${basketAmt.toFixed(0)}`:"-"}</div>
                      <div style={{fontSize:10,color,marginTop:1}}>{dep>0?`${tokensFromBasket.toFixed(1)} tokens at $${bundle.nav.toFixed(3)}`:"-"}</div>
                    </div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                  <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`0.5px solid ${C.border}`}}>
                    <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,letterSpacing:"0.06em",marginBottom:6}}>WORST CASE</div>
                    <div style={{fontSize:18,fontWeight:600,color:C.textPrimary,fontFamily:FS}}>{dep>0?`$${worstCase.toFixed(0)}`:"-"}</div>
                    <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,marginTop:4}}>Vault back · basket zero</div>
                  </div>
                  <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`0.5px solid ${C.border}`}}>
                    <div style={{fontSize:10,color:C.green,fontFamily:FS,letterSpacing:"0.06em",marginBottom:6}}>BEST CASE</div>
                    <div style={{fontSize:18,fontWeight:600,color:C.textPrimary,fontFamily:FS}}>{dep>0?`$${bestCase.toFixed(0)}`:"-"}</div>
                    <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,marginTop:4}}>Vault + basket at $1.00</div>
                  </div>
                </div>
                <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,marginBottom:14,textAlign:"center"}}>
                  Split optimized for {apy}% APY · {bundle.daysLeft}d timeline
                </div>
                <button onClick={handleConfirm} disabled={insufficient || dep<=0} style={{width:"100%",padding:"12px 0",borderRadius:10,border:"none",background:confirmed?C.green:(insufficient||dep<=0)?C.border:C.teal,color:(insufficient||dep<=0)?C.textMuted:"#000",fontSize:14,fontWeight:700,fontFamily:FD,cursor:(insufficient||dep<=0)?"not-allowed":"pointer",marginBottom:8,transition:`all 0.25s ${EASE}`,opacity:(insufficient||dep<=0)?0.7:1}}>
                  {confirmed?"✓ Protected":demoMode?"Execute protection":"Confirm protection"}
                </button>
                <button onClick={()=>setPpnMode(false)} style={{width:"100%",padding:"8px 0",borderRadius:10,border:`0.5px solid ${C.border}`,background:"transparent",color:C.textSecondary,fontSize:12,fontFamily:FS,cursor:"pointer"}}>
                  Back to standard deposit
                </button>
              </>
            )}
            <div style={{fontSize:10,color:C.textMuted,textAlign:"center",marginTop:10,fontFamily:FS}}>
              {demoMode?"Demo mode · no real transactions":`Auto-redeems at resolution · Sui ${process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet"}`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// PORTFOLIO - orbital-themed redesign
// Keeps donut mechanics 100% untouched. Adds:
//  - Slow-rotating concentric orbital rings around the donut (decorative)
//  - Soft corona glow behind the donut to echo the landing's central star
//  - Planet/satellite dots on the rings
//  - Orbital-styled stat cards with top accent bar
//  - Bottom orbital horizon line beneath the positions table
// =========================================================================
function PortfolioPage({ onSelect, portfolio, vaultPositions, usdcBalance, demoMode }: {
  onSelect:(b:Bundle,from:string)=>void,
  portfolio:Position[],
  vaultPositions:VaultPos[],
  usdcBalance:number,
  demoMode:boolean,
}) {
  const isMobile = useMobile();
  const [activeId,setActiveId]=useState<string|null>(null);

  const lkrsPositions=portfolio.map(p=>{
    const bundle=BUNDLES.find(b=>b.id===p.id)!;
    const currentVal=p.qty*bundle.nav;
    const pnl=currentVal-p.qty*p.avgCost;
    const pnlPct=((bundle.nav-p.avgCost)/p.avgCost)*100;
    const maxPayout = p.qty * 1.00;
    const unresolved = bundle.totalLegs - bundle.resolved;
    return {id:p.id,bundle,currentVal,pnl,pnlPct,color:tc(bundle.tier),qty:p.qty,avgCost:p.avgCost,maxPayout,unresolved};
  });

  const vaultDerived = vaultPositions.map(v=>({
    ...v, currentVal:v.principal+v.yieldEarned, pnl:v.yieldEarned,
    pnlPct:v.principal>0?(v.yieldEarned/v.principal)*100:0, color:C.teal,
  }));

  const usdcPos={id:"USDC",currentVal:usdcBalance,pnl:0,pnlPct:0,color:"#4a5a6a"};

  const allForDonut=[
    ...lkrsPositions.map(p=>({id:p.id,value:p.currentVal,color:p.color})),
    ...vaultDerived.map(v=>({id:v.id,value:v.currentVal,color:v.color})),
    {id:"USDC",value:usdcPos.currentVal,color:usdcPos.color},
  ].filter(p=>p.value>0).sort((a,b)=>b.value-a.value);

  const totalValue=allForDonut.reduce((s,p)=>s+p.value,0);
  const totalPnl=lkrsPositions.reduce((s,p)=>s+p.pnl,0)+vaultDerived.reduce((s,v)=>s+v.pnl,0);
  const weightedProb= totalValue>0 ? (
    lkrsPositions.reduce((s,p)=>s+((p.bundle.tier/100)*p.currentVal),0)
    + vaultDerived.reduce((s,v)=>s+v.currentVal,0)
    + usdcPos.currentVal
  )/totalValue*100 : 0;

  const totalMaxPayout = lkrsPositions.reduce((s,p)=>s+p.maxPayout, 0) +
                        vaultDerived.reduce((s,v)=>s+v.principal, 0) +
                        usdcPos.currentVal;

  const activeLkrs=activeId?lkrsPositions.find(p=>p.id===activeId):null;
  const activeVault=activeId?vaultDerived.find(v=>v.id===activeId):null;
  const activeUsdc=activeId==="USDC";
  const activePos=activeLkrs??activeVault??(activeUsdc?usdcPos:null);
  const activeColor=activeLkrs?.color??activeVault?.color??(activeUsdc?"#4a5a6a":null);
  const activeShare=activePos?(activePos.currentVal/totalValue*100):null;

  const hasNoPositions = lkrsPositions.length === 0 && vaultDerived.length === 0;
  const isFullyEmpty = hasNoPositions && usdcBalance === 0;

  // Size the donut + orbital system
  const donutSize = isMobile ? 280 : 340;
  const systemSize = isMobile ? 520 : 680; // orbital frame around donut

  return (
    <div>
      {/* Orbital page header */}
      <div style={{marginBottom:24,position:"relative",padding:"4px 0 22px",borderBottom:`0.5px solid rgba(45, 212, 191, 0.1)`,display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:20,flexWrap:"wrap"}}>
        <div style={{position:"absolute",top:0,right:0,width:220,height:140,background:`radial-gradient(ellipse at top right, rgba(45, 212, 191, 0.1) 0%, transparent 70%)`,pointerEvents:"none"}} />
        <div style={{position:"relative"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{width:18,height:1,background:C.tealLight,opacity:0.6}} />
            <span style={{fontFamily:FM,fontSize:10,letterSpacing:"0.22em",color:C.tealLight,fontWeight:500}}>PORTFOLIO</span>
            <span style={{width:18,height:1,background:C.tealLight,opacity:0.6}} />
          </div>
          <div style={{fontSize:isMobile?26:32,fontWeight:200,color:C.textPrimary,fontFamily:FD,letterSpacing:"-0.02em"}}>Your <span style={{fontWeight:500,background:`linear-gradient(90deg, ${C.tealLight} 0%, #a5f3fc 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>orbit</span></div>
        </div>
        {demoMode && !hasNoPositions && (
          <div style={{textAlign:"right",position:"relative"}}>
            <div style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.18em",marginBottom:4,fontWeight:500}}>MAX POTENTIAL VALUE</div>
            <div style={{fontSize:22,fontWeight:300,color:C.green,fontFamily:FD,letterSpacing:"-0.02em"}}>${totalMaxPayout.toFixed(0)}</div>
          </div>
        )}
      </div>

      {/* Orbital stat cards - top accent bar mirrors tier colors */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:isMobile?8:12,marginBottom:24}}>
        {[
          ["TOTAL VALUE",`$${totalValue.toFixed(2)}`,C.green,C.tealLight],
          ["UNREALIZED P&L",`${totalPnl>=0?"+":""}$${totalPnl.toFixed(2)}`,totalPnl>=0?C.green:C.red,"#fbbf24"],
          ["WEIGHTED PROB",`${weightedProb.toFixed(1)}%`,C.teal,"#fb923c"]
        ].map(([label,val,color,accent])=>(
          <div key={label as string} style={{
            background:`linear-gradient(180deg, ${C.card} 0%, ${darkenColor(C.card, 0.15)} 100%)`,
            border:`0.5px solid ${C.border}`,
            borderRadius:14,
            padding:isMobile?"14px 12px":"20px 22px",
            position:"relative",
            overflow:"hidden",
          }}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:1.5,background:`linear-gradient(90deg, transparent 0%, ${accent as string}99 50%, transparent 100%)`,opacity:0.7}} />
            <div style={{position:"absolute",top:-40,right:-40,width:120,height:120,borderRadius:"50%",background:`radial-gradient(circle, ${accent as string}18 0%, transparent 65%)`,pointerEvents:"none"}} />
            <div style={{fontSize:isMobile?8:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.12em",marginBottom:isMobile?6:10,lineHeight:1.3,position:"relative"}}>{label as string}</div>
            <div style={{fontSize:isMobile?16:26,fontWeight:500,color:color as string,fontFamily:FS,letterSpacing:"-0.01em",position:"relative"}}>{val as string}</div>
          </div>
        ))}
      </div>

      {/* ORBITAL DONUT CARD - full space-theme treatment */}
      <div style={{
        background:`linear-gradient(180deg, ${C.card} 0%, ${darkenColor(C.card, 0.15)} 100%)`,
        border:`0.5px solid ${C.border}`,
        borderRadius:24,
        marginBottom:20,
        overflow:"hidden",
        position:"relative",
        boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 20px 60px rgba(0,0,0,0.2)",
      }}>
        {/* Deep space gradient wash */}
        <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 80% 60% at 50% 50%, rgba(45, 212, 191, 0.04) 0%, transparent 70%)`,pointerEvents:"none"}} />

        {/* Top accent ribbon - mirrors the landing tier cards */}
        <div style={{position:"absolute",top:0,left:0,right:0,height:1.5,background:`linear-gradient(90deg, transparent 0%, ${C.tealLight}66 20%, ${C.tealLight} 50%, ${C.tealLight}66 80%, transparent 100%)`,opacity:0.6}} />

        {/* Active color wash */}
        <div style={{position:"absolute",inset:0,background:activeId&&activeColor?`radial-gradient(ellipse 60% 50% at 50% 45%, ${activeColor}22 0%, transparent 70%)`:"transparent",transition:`background 0.6s ${EASE}`,pointerEvents:"none"}} />

        <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:isMobile?"48px 0 36px":"64px 0 52px",position:"relative"}}>

          {/* Header strip */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:isMobile?28:36,position:"relative",zIndex:5}}>
            <span style={{width:24,height:1,background:C.textMuted}} />
            <span style={{fontFamily:FM,fontSize:isMobile?9:10,letterSpacing:"0.22em",color:C.textMuted}}>YOUR ORBIT</span>
            <span style={{width:24,height:1,background:C.textMuted}} />
          </div>

          {/* Orbital system wrapper - rings + corona behind the donut */}
          <div style={{position:"relative",width:systemSize,height:systemSize,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:isMobile?28:40}}>

            {/* Corona glow - echoes central star from landing */}
            <div style={{
              position:"absolute",
              width:donutSize*1.15,height:donutSize*1.15,
              borderRadius:"50%",
              background:`radial-gradient(circle, ${activeColor || C.tealLight}18 0%, ${activeColor || C.tealLight}08 40%, transparent 70%)`,
              filter:"blur(20px)",
              transition:`background 0.6s ${EASE}`,
              pointerEvents:"none",
            }} />

            {/* Ring 1 - innermost, teal - slow spin */}
            <div className="senthos-orbit-slow" style={{
              position:"absolute",
              width: donutSize * 1.28,
              height: donutSize * 1.28,
              borderRadius:"50%",
              border:`1px solid rgba(45, 212, 191, 0.18)`,
              boxShadow:"0 0 30px rgba(45, 212, 191, 0.08) inset",
              pointerEvents:"none",
            }}>
              <div style={{position:"absolute",top:"50%",left:0,transform:"translate(-50%, -50%)",width:6,height:6,borderRadius:"50%",background:C.tealLight,boxShadow:`0 0 10px ${C.tealLight}`}} />
            </div>

            {/* Ring 2 - middle, amber - counter spin */}
            <div className="senthos-orbit-med" style={{
              position:"absolute",
              width: donutSize * 1.55,
              height: donutSize * 1.55,
              borderRadius:"50%",
              border:`1px solid rgba(217, 119, 6, 0.14)`,
              pointerEvents:"none",
            }}>
              <div style={{position:"absolute",top:0,left:"50%",transform:"translate(-50%, -50%)",width:5,height:5,borderRadius:"50%",background:"#fbbf24",boxShadow:"0 0 10px #fbbf24"}} />
            </div>

            {/* Ring 3 - outermost, coral - slow spin */}
            <div className="senthos-orbit-fast" style={{
              position:"absolute",
              width: donutSize * 1.82,
              height: donutSize * 1.82,
              borderRadius:"50%",
              border:`1px solid rgba(234, 88, 12, 0.1)`,
              pointerEvents:"none",
            }}>
              <div style={{position:"absolute",top:"50%",right:0,transform:"translate(50%, -50%)",width:4,height:4,borderRadius:"50%",background:"#fb923c",boxShadow:"0 0 8px #fb923c"}} />
            </div>

            {/* The donut itself - mechanics untouched */}
            <div style={{position:"relative",zIndex:3}}>
              <SvgDonut data={allForDonut} size={donutSize} activeId={activeId} onHover={setActiveId} isEmpty={allForDonut.length===0} />
              <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center",pointerEvents:"none",width:200}}>
                {isFullyEmpty ? (
                  <div>
                    <div style={{fontSize:11,color:C.textMuted,fontFamily:FM,letterSpacing:"0.14em",marginBottom:12}}>NO POSITIONS</div>
                    <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS,lineHeight:1.5}}>
                      Your orbit is empty
                    </div>
                  </div>
                ) : activeId && activePos ? (
                  <div key={activeId} style={{animation:`fadeIn 0.35s ${EASE}`}}>
                    <div style={{display:"inline-block",padding:"3px 10px",borderRadius:20,background:(activeColor||C.teal)+"22",border:`0.5px solid ${activeColor||C.teal}55`,marginBottom:12}}>
                      <span style={{fontSize:9,color:activeColor||C.teal,fontFamily:FM,letterSpacing:"0.12em",fontWeight:600}}>{activeId}</span>
                    </div>
                    <div style={{fontSize:38,fontWeight:600,color:C.textPrimary,fontFamily:FS,lineHeight:1,marginBottom:8,letterSpacing:"-0.03em"}}>{activeShare?.toFixed(1)}%</div>
                    <div style={{fontSize:14,color:C.textSecondary,fontFamily:FS,marginBottom:4}}>${activePos.currentVal.toFixed(0)}</div>
                    {activePos.pnl !== 0 && (
                      <div style={{fontSize:12,color:activePos.pnl>=0?C.green:C.red,fontFamily:FS,fontWeight:500}}>
                        {activePos.pnl>=0?"+":""}{activePos.pnlPct.toFixed(1)}%
                      </div>
                    )}
                  </div>
                ) : (
                  <div key="total" style={{animation:`fadeIn 0.35s ${EASE}`}}>
                    <div style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.14em",marginBottom:12}}>TOTAL VALUE</div>
                    <div style={{fontSize:38,fontWeight:600,color:C.textPrimary,fontFamily:FS,lineHeight:1,marginBottom:10,letterSpacing:"-0.03em"}}>${totalValue.toFixed(0)}</div>
                    <div style={{fontSize:11,color:C.textMuted,fontFamily:FM,letterSpacing:"0.08em"}}>{allForDonut.length} POSITION{allForDonut.length!==1?"S":""}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tier legend chips */}
          {!isFullyEmpty && (
            <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",maxWidth:500,position:"relative",zIndex:5}}>
              {[90,70,50].map(tier=>{
                const tp=lkrsPositions.filter(p=>p.bundle.tier===tier);
                if(!tp.length) return null;
                const tv=tp.reduce((s,p)=>s+p.currentVal,0);
                const isAct=activeId&&activeLkrs?.bundle.tier===tier;
                return (
                  <div key={tier} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 13px",borderRadius:100,background:isAct?tc(tier)+"22":C.surface,border:`0.5px solid ${isAct?tc(tier)+"66":C.border}`,transition:`all 0.3s ${EASE}`,backdropFilter:"blur(8px)"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:tc(tier),boxShadow:isAct?`0 0 8px ${tc(tier)}`:"none"}} />
                    <span style={{fontSize:11,color:C.textSecondary,fontFamily:FM,letterSpacing:"0.06em"}}>{tier}%</span>
                    <span style={{fontSize:11,fontWeight:500,color:isAct?tc(tier):C.textPrimary,fontFamily:FS,transition:`color 0.3s ${EASE}`}}>${tv.toFixed(0)}</span>
                  </div>
                );
              })}
              {vaultDerived.map(v=>(
                <div key={v.id} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 13px",borderRadius:100,background:activeId===v.id?C.tealBg:C.surface,border:`0.5px solid ${activeId===v.id?C.teal+"66":C.border}`,transition:`all 0.3s ${EASE}`,backdropFilter:"blur(8px)"}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:C.teal,boxShadow:activeId===v.id?`0 0 8px ${C.teal}`:"none"}} />
                  <span style={{fontSize:11,color:C.textSecondary,fontFamily:FM,letterSpacing:"0.06em"}}>Vault</span>
                  <span style={{fontSize:11,fontWeight:500,color:activeId===v.id?C.teal:C.textPrimary,fontFamily:FS,transition:`color 0.3s ${EASE}`}}>${v.currentVal.toFixed(0)}</span>
                </div>
              ))}
              {usdcBalance>0 && (
                <div style={{display:"flex",alignItems:"center",gap:7,padding:"6px 13px",borderRadius:100,background:activeId==="USDC"?"#4a5a6a22":C.surface,border:`0.5px solid ${activeId==="USDC"?"#4a5a6a66":C.border}`,transition:`all 0.3s ${EASE}`,backdropFilter:"blur(8px)"}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:"#4a5a6a"}} />
                  <span style={{fontSize:11,color:C.textSecondary,fontFamily:FM,letterSpacing:"0.06em"}}>USDC</span>
                  <span style={{fontSize:11,fontWeight:500,color:activeId==="USDC"?"#8a9aaa":C.textPrimary,fontFamily:FS,transition:`color 0.3s ${EASE}`}}>${usdcBalance.toFixed(0)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {hasNoPositions && (
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:16,padding:"40px 24px",textAlign:"center",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:1.5,background:`linear-gradient(90deg, transparent 0%, ${C.tealLight}66 50%, transparent 100%)`,opacity:0.4}} />
          <div style={{fontSize:14,color:C.textSecondary,fontFamily:FS,marginBottom:6}}>No constellation positions yet</div>
          <div style={{fontSize:12,color:C.textMuted,fontFamily:FS}}>
            {demoMode ? "Head to Constellations or Markets to make your first demo purchase" : "Connect a wallet and deposit to get started"}
          </div>
        </div>
      )}

      {!hasNoPositions && (
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:16,overflow:"hidden",position:"relative"}}>
          {/* subtle top accent */}
          <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg, transparent 0%, ${C.border} 50%, transparent 100%)`,opacity:0.8,zIndex:1}} />

          {/* Section header */}
          <div style={{padding:isMobile?"14px 16px 10px":"16px 24px 12px",borderBottom:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:20,height:1,background:C.textMuted}} />
            <span style={{fontFamily:FM,fontSize:10,letterSpacing:"0.2em",color:C.textMuted}}>HOLDINGS</span>
            <span style={{flex:1,height:1,background:`linear-gradient(90deg, ${C.textMuted}33 0%, transparent 100%)`}} />
            <span style={{fontFamily:FM,fontSize:10,letterSpacing:"0.08em",color:C.textMuted}}>{lkrsPositions.length + vaultDerived.length + (usdcBalance>0?1:0)} POSITIONS</span>
          </div>

          {isMobile ? (
            // MOBILE: compact card rows
            <div>
              {[90,70,50].map(tier=>{
                const tp=lkrsPositions.filter(p=>p.bundle.tier===tier).sort((a,b)=>b.currentVal-a.currentVal);
                if(!tp.length) return null;
                return (
                  <div key={tier}>
                    <div style={{padding:"7px 16px",background:C.surface,borderBottom:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:tc(tier),boxShadow:`0 0 6px ${tc(tier)}66`}} />
                      <span style={{fontSize:10,color:tc(tier),fontFamily:FM,fontWeight:500,letterSpacing:"0.1em"}}>{tier}% TIER</span>
                    </div>
                    {tp.map(p=>(
                      <div key={p.id} onClick={()=>onSelect(p.bundle,"portfolio")}
                        style={{padding:"12px 16px",borderBottom:`0.5px solid ${C.border}`,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,transition:`background 0.2s ${EASE}`}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=C.cardHover;}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";}}
                      >
                        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                          <div style={{width:3,height:32,borderRadius:2,background:p.color,flexShrink:0,boxShadow:`0 0 6px ${p.color}66`}} />
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:C.textPrimary,fontFamily:FD}}>{p.id}</div>
                            <div style={{fontSize:11,color:C.textMuted,fontFamily:FS,marginTop:1}}>{p.bundle.resolved}/{p.bundle.totalLegs} resolved · {p.bundle.daysLeft}d</div>
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:13,fontWeight:500,color:C.textPrimary,fontFamily:FS}}>${p.currentVal.toFixed(0)}</div>
                          <div style={{fontSize:11,fontWeight:600,color:p.pnl>=0?C.green:C.red,fontFamily:FD}}>{p.pnl>=0?"+":""}{p.pnlPct.toFixed(1)}%</div>
                          <div style={{fontSize:10,color:C.textMuted,fontFamily:FS}}>max ${p.maxPayout.toFixed(0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {vaultDerived.length>0&&(
                <div>
                  <div style={{padding:"7px 16px",background:C.surface,borderBottom:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:C.teal,boxShadow:`0 0 6px ${C.teal}66`}} />
                    <span style={{fontSize:10,color:C.teal,fontFamily:FM,fontWeight:500,letterSpacing:"0.1em"}}>METEORA VAULT</span>
                  </div>
                  {vaultDerived.map(v=>(
                    <div key={v.id} style={{padding:"12px 16px",borderBottom:`0.5px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:3,height:32,borderRadius:2,background:C.teal,flexShrink:0,boxShadow:`0 0 6px ${C.teal}66`}} />
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:13,fontWeight:600,color:C.textPrimary,fontFamily:FD}}>{v.label}</span>
                            <span style={{fontSize:9,padding:"2px 5px",borderRadius:8,background:C.tealBg,color:C.teal,border:`0.5px solid ${C.teal}44`,fontFamily:FM,letterSpacing:"0.08em"}}>PROTECTED</span>
                          </div>
                          <div style={{fontSize:11,color:C.textMuted,fontFamily:FS,marginTop:1}}>{v.apy}% APY · {v.daysLeft}d left</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:13,fontWeight:500,color:C.textPrimary,fontFamily:FS}}>${v.currentVal.toFixed(0)}</div>
                        <div style={{fontSize:11,color:C.green,fontFamily:FS}}>+${v.yieldEarned.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div style={{padding:"7px 16px",background:C.surface,borderBottom:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:"#4a5a6a"}} />
                  <span style={{fontSize:10,color:"#6b8099",fontFamily:FM,fontWeight:500,letterSpacing:"0.1em"}}>CASH</span>
                </div>
                <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:3,height:32,borderRadius:2,background:"#4a5a6a",flexShrink:0}} />
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:C.textPrimary,fontFamily:FD}}>USDC</div>
                      <div style={{fontSize:11,color:C.textMuted,fontFamily:FS}}>Available</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:500,color:C.textPrimary,fontFamily:FS}}>${usdcBalance.toFixed(0)}</div>
                    <div style={{fontSize:11,color:C.textMuted,fontFamily:FS}}>0.0%</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // DESKTOP: full table
            <div>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1.2fr 90px 80px",padding:"10px 24px",borderBottom:`0.5px solid ${C.border}`}}>
                {["Position","Qty","NAV","Value","Max payout","30d","P&L"].map(h=>(
                  <div key={h} style={{fontSize:10,color:C.textMuted,fontFamily:FM,letterSpacing:"0.1em"}}>{h.toUpperCase()}</div>
                ))}
              </div>
              {[90,70,50].map(tier=>{
                const tp=lkrsPositions.filter(p=>p.bundle.tier===tier).sort((a,b)=>b.currentVal-a.currentVal);
                if(!tp.length) return null;
                return (
                  <div key={tier}>
                    <div style={{padding:"7px 24px",background:C.surface,borderBottom:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:tc(tier),boxShadow:`0 0 6px ${tc(tier)}66`}} />
                      <span style={{fontSize:10,color:tc(tier),fontFamily:FM,fontWeight:500,letterSpacing:"0.1em"}}>{tier}% TIER</span>
                    </div>
                    {tp.map(p=>(
                      <div key={p.id}
                        onClick={()=>onSelect(p.bundle,"portfolio")}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=C.cardHover;setActiveId(p.id);}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";setActiveId(null);}}
                        style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1.2fr 90px 80px",padding:"13px 24px",borderBottom:`0.5px solid ${C.border}`,cursor:"pointer",transition:`background 0.2s ${EASE}`,alignItems:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:3,height:30,borderRadius:2,background:p.color,flexShrink:0,boxShadow:`0 0 6px ${p.color}66`}} />
                          <div>
                            <div style={{fontSize:13,fontWeight:600,color:C.textPrimary,fontFamily:FD}}>{p.id}</div>
                            <div style={{fontSize:11,color:C.textMuted,fontFamily:FS,marginTop:1}}>{p.bundle.daysLeft}d · {p.bundle.resolved}/{p.bundle.totalLegs} resolved</div>
                          </div>
                        </div>
                        <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS}}>{p.qty.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                        <div style={{fontSize:13,fontWeight:600,color:p.color,fontFamily:FD}}>${p.bundle.nav.toFixed(3)}</div>
                        <div style={{fontSize:13,fontWeight:500,color:C.textPrimary,fontFamily:FS}}>${p.currentVal.toFixed(0)}</div>
                        <div>
                          <div style={{fontSize:13,fontWeight:500,color:C.green,fontFamily:FD}}>${p.maxPayout.toFixed(0)}</div>
                          <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,marginTop:1}}>{p.unresolved} leg{p.unresolved!==1?"s":""} to resolve</div>
                        </div>
                        <div><Sparkline data={p.bundle.history} color={p.color} height={26} width={80} /></div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:13,fontWeight:600,color:p.pnl>=0?C.green:C.red,fontFamily:FD}}>{p.pnl>=0?"+":""}{p.pnlPct.toFixed(1)}%</div>
                          <div style={{fontSize:10,color:C.textMuted,fontFamily:FS}}>{p.pnl>=0?"+":""}${p.pnl.toFixed(0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {vaultDerived.length>0&&(
                <div>
                  <div style={{padding:"7px 24px",background:C.surface,borderBottom:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:C.teal,boxShadow:`0 0 6px ${C.teal}66`}} />
                    <span style={{fontSize:10,color:C.teal,fontFamily:FM,fontWeight:500,letterSpacing:"0.1em"}}>METEORA VAULT</span>
                  </div>
                  {vaultDerived.map(v=>(
                    <div key={v.id}
                      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=C.cardHover;setActiveId(v.id);}}
                      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";setActiveId(null);}}
                      style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1.2fr 90px 80px",padding:"13px 24px",borderBottom:`0.5px solid ${C.border}`,cursor:"default",transition:`background 0.2s ${EASE}`,alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:3,height:30,borderRadius:2,background:C.teal,flexShrink:0,boxShadow:`0 0 6px ${C.teal}66`}} />
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:13,fontWeight:600,color:C.textPrimary,fontFamily:FD}}>{v.label}</span>
                            <span style={{fontSize:9,padding:"2px 6px",borderRadius:10,background:C.tealBg,color:C.teal,border:`0.5px solid ${C.teal}44`,fontWeight:500,fontFamily:FM,letterSpacing:"0.08em"}}>PROTECTED</span>
                          </div>
                          <div style={{fontSize:11,color:C.textMuted,fontFamily:FS,marginTop:1}}>{v.daysLeft}d remaining · redeemable anytime</div>
                        </div>
                      </div>
                      <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS}}>${v.principal.toFixed(0)}</div>
                      <div style={{fontSize:13,color:C.teal,fontFamily:FS}}>{v.apy}% APY</div>
                      <div style={{fontSize:13,fontWeight:500,color:C.textPrimary,fontFamily:FS}}>${v.currentVal.toFixed(0)}</div>
                      <div>
                        <div style={{fontSize:13,fontWeight:500,color:C.teal,fontFamily:FD}}>${v.principal.toFixed(0)}</div>
                        <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,marginTop:1}}>guaranteed floor</div>
                      </div>
                      <div>
                        <div style={{height:3,background:C.border,borderRadius:2,overflow:"hidden",marginBottom:3,maxWidth:80}}>
                          <div style={{width:`${(1-v.daysLeft/v.daysTotal)*100}%`,height:"100%",background:C.teal,borderRadius:2}} />
                        </div>
                        <div style={{fontSize:10,color:C.textMuted,fontFamily:FS}}>earning</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.green,fontFamily:FD}}>+{v.pnlPct.toFixed(1)}%</div>
                        <div style={{fontSize:10,color:C.textMuted,fontFamily:FS}}>+${v.pnl.toFixed(0)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div style={{padding:"7px 24px",background:C.surface,borderBottom:`0.5px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:"#4a5a6a"}} />
                  <span style={{fontSize:10,color:"#6b8099",fontFamily:FM,fontWeight:500,letterSpacing:"0.1em"}}>CASH</span>
                </div>
                <div
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=C.cardHover;setActiveId("USDC");}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";setActiveId(null);}}
                  style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1.2fr 90px 80px",padding:"13px 24px",cursor:"default",transition:`background 0.2s ${EASE}`,alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:3,height:30,borderRadius:2,background:"#4a5a6a",flexShrink:0}} />
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:C.textPrimary,fontFamily:FD}}>USDC</div>
                      <div style={{fontSize:11,color:C.textMuted,fontFamily:FS,marginTop:1}}>Sui testnet · available</div>
                    </div>
                  </div>
                  <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS}}>${usdcBalance.toFixed(0)}</div>
                  <div style={{fontSize:13,color:C.textMuted,fontFamily:FS}}>$1.000</div>
                  <div style={{fontSize:13,fontWeight:500,color:C.textPrimary,fontFamily:FS}}>${usdcBalance.toFixed(0)}</div>
                  <div>
                    <div style={{fontSize:13,color:C.textSecondary,fontFamily:FD}}>${usdcBalance.toFixed(0)}</div>
                    <div style={{fontSize:10,color:C.textMuted,fontFamily:FS,marginTop:1}}>stable</div>
                  </div>
                  <div><Sparkline data={USDC_HISTORY} color="#4a5a6a" height={26} width={80} /></div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,color:C.textMuted,fontFamily:FD}}>0.0%</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// =========================================================================
// STARFIELD - subtle atmospheric background for all app pages
// =========================================================================
function StarfieldBG() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    let stars: {x:number,y:number,r:number,tw:number,speed:number}[] = [];
    let raf = 0;

    const resize = () => {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
      stars = [];
      const count = Math.floor((c.width * c.height) / 9000);
      for (let i=0;i<count;i++) {
        stars.push({
          x: Math.random()*c.width,
          y: Math.random()*c.height,
          r: Math.random()*0.9 + 0.2,
          tw: Math.random()*Math.PI*2,
          speed: Math.random()*0.0025 + 0.001,
        });
      }
    };
    const draw = () => {
      ctx.clearRect(0,0,c.width,c.height);
      const isLight = typeof document !== "undefined" &&
        document.documentElement.dataset.theme === "light";
      const rgb = isLight ? "30, 70, 95" : "180, 210, 235";
      const alphaBoost = isLight ? 0.35 : 0;
      for (const s of stars) {
        const alpha = (Math.sin(s.tw)+1)/2 * 0.35 + 0.15 + alphaBoost;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.85, alpha)})`;
        ctx.fill();
        s.tw += s.speed;
      }
      raf = requestAnimationFrame(draw);
    };
    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={ref} style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none"}} />;
}

// =========================================================================
// LANDING PAGE - CENTERED orbital hero
// =========================================================================
// FlybyCanvas - distant planets + occasional comet streaks drifting past camera.
// Pure canvas for perf. Objects depth-sorted, spawn behind camera (z large),
// accelerate toward camera (z → 0), culled when offscreen.
function FlybyCanvas({ scrollProgress }: { scrollProgress: { current: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    let w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Object pools
    type Planet = { x:number; y:number; z:number; vx:number; vy:number; vz:number; r:number; color:string; ring:boolean; rot:number; };
    type Comet = { x:number; y:number; vx:number; vy:number; life:number; maxLife:number; color:string; };

    const planets: Planet[] = [];
    const comets: Comet[] = [];

    const MAX_PLANETS = 1;

    const rand = (a:number, b:number) => a + Math.random()*(b-a);

    const spawnPlanet = () => {
      const side = Math.random() < 0.5 ? -1 : 1;
      const colors = ["#2dd4bf", "#fbbf24", "#fb923c", "#a78bfa", "#60a5fa", "#f472b6"];
      planets.push({
        x: side * rand(400, 700), y: rand(-300, 300),
        z: rand(1800, 2400),
        vx: -side * rand(0.3, 0.55), vy: rand(-0.08, 0.08),
        vz: rand(-1.4, -0.8),
        r: rand(40, 90),
        color: colors[Math.floor(Math.random()*colors.length)],
        ring: Math.random() < 0.5,
        rot: rand(0, Math.PI),
      });
    };
    const spawnComet = () => {
      // Fast diagonal streak across viewport
      const fromLeft = Math.random() < 0.5;
      const y0 = rand(0, h);
      const speed = rand(8, 12); // slower, more graceful streaks
      const angle = rand(-0.3, 0.3) + (fromLeft ? 0 : Math.PI);
      const tealComet = Math.random() < 0.6;
      comets.push({
        x: fromLeft ? -50 : w+50, y: y0,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed + rand(-1,1),
        life: 0, maxLife: rand(70, 120),
        color: tealComet ? "#2dd4bf" : "#fb923c",
      });
    };

    let raf = 0;
    let frame = 0;
    const render = () => {
      frame++;
      const cx = w/2, cy = h/2;
      const FOCAL = 500;

      ctx.clearRect(0, 0, w, h);

      // scroll-driven camera roll (very subtle)
      const prog = scrollProgress.current;
      const rollRad = Math.sin(prog * Math.PI * 2) * 0.02;

      // Spawn planets very rarely
      if (planets.length < MAX_PLANETS && Math.random() < 0.0008) spawnPlanet();
      // Spawn comets rarely, max 2 on screen at once
      if (comets.length < 2 && Math.random() < 0.003) spawnComet();

      // Depth-sorted render array
      // Planet-only drawables (depth sorted)
      const drawables: Planet[] = [];

      // Update planets
      for (let i = planets.length - 1; i >= 0; i--) {
        const p = planets[i];
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        p.rot += 0.003;
        if (p.z < 100 || Math.abs(p.x) > 2000) {
          planets.splice(i, 1);
          continue;
        }
        drawables.push(p);
      }
      // Sort far-to-near
      drawables.sort((A,B) => B.z - A.z);

      // Apply camera roll by rotating whole ctx for space objects
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rollRad);

      for (const p of drawables) {
        {
          const scale = FOCAL / (FOCAL + p.z);
          const sx = p.x * scale;
          const sy = p.y * scale;
          const sr = p.r * scale;
          if (sr < 0.5) continue;

          // Atmospheric glow
          const glow = ctx.createRadialGradient(sx, sy, sr*0.7, sx, sy, sr*2.2);
          glow.addColorStop(0, p.color + "80");
          glow.addColorStop(1, p.color + "00");
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(sx, sy, sr*2.2, 0, Math.PI*2); ctx.fill();

          // Planet body with shadow
          const bodyGrad = ctx.createRadialGradient(sx - sr*0.3, sy - sr*0.3, sr*0.1, sx, sy, sr);
          bodyGrad.addColorStop(0, "#ffffff");
          bodyGrad.addColorStop(0.15, p.color);
          bodyGrad.addColorStop(1, "#06101a");
          ctx.fillStyle = bodyGrad;
          ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();

          // Rings
          if (p.ring) {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(p.rot);
            ctx.scale(1, 0.25);
            ctx.strokeStyle = p.color + "cc";
            ctx.lineWidth = Math.max(1, sr*0.08);
            ctx.beginPath(); ctx.arc(0, 0, sr*1.6, 0, Math.PI*2); ctx.stroke();
            ctx.strokeStyle = p.color + "66";
            ctx.lineWidth = Math.max(0.5, sr*0.04);
            ctx.beginPath(); ctx.arc(0, 0, sr*1.9, 0, Math.PI*2); ctx.stroke();
            ctx.restore();
          }
        }
      }
      ctx.restore();

      // Comets (screen-space, above everything)
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.x += c.vx; c.y += c.vy; c.life++;
        if (c.life > c.maxLife || c.x < -200 || c.x > w+200) {
          comets.splice(i, 1);
          continue;
        }
        const alpha = 1 - c.life/c.maxLife;
        // Long streak tail
        const tailLen = 180;
        const tx = c.x - c.vx * 8;
        const ty = c.y - c.vy * 8;
        const trail = ctx.createLinearGradient(tx, ty, c.x, c.y);
        trail.addColorStop(0, c.color + "00");
        trail.addColorStop(0.6, c.color + "80");
        trail.addColorStop(1, "#ffffff" + (alpha > 0.5 ? "ff" : Math.floor(alpha*2*255).toString(16).padStart(2,"0")));
        ctx.strokeStyle = trail;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(c.x - c.vx*tailLen/10, c.y - c.vy*tailLen/10);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
        // Bright head
        const headGrad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 8);
        headGrad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        headGrad.addColorStop(0.4, c.color);
        headGrad.addColorStop(1, c.color + "00");
        ctx.fillStyle = headGrad;
        ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI*2); ctx.fill();
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} style={{position:"fixed",inset:0,width:"100vw",height:"100vh",zIndex:4,pointerEvents:"none"}} />;
}

// Camera path - flying TOWARD the star while orbiting slightly.
// Physics: we're on an inbound spiral trajectory. The star grows as we approach,
// we arc subtly around it but primarily get closer. Less dramatic sideways
// motion, more "hyperdrive approach" feel.
function cameraPath(progress: number) {
  // Normalize progress 0..1 across the full scroll
  const p = Math.max(0, Math.min(4, progress));
  const t = p / 4;

  // Smoother ease
  const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2;

  // ORBITAL ANGLE - much tighter arc now, we're not orbiting past, we're flying in.
  // Gentle sweep from +25deg to -25deg so the star stays roughly centered
  // but feels like we're circling slightly as we approach.
  const thetaDeg = 25 - ease * 50;
  const theta = thetaDeg * Math.PI / 180;

  // Horizontal position - subtle, star stays near center
  const x = Math.sin(theta) * 0.18;
  // Slight vertical drift for organic feel
  const y = -Math.cos(theta) * 0.06 - 0.02 + Math.sin(t * Math.PI) * 0.03;

  // SCALE - this is the star of the show now. Grows from 0.7 (distant)
  // to 2.2 (close approach), giving that "flying toward" feel.
  const scale = 0.7 + ease * 1.5;

  // Gentle banking - we lean into the slight turn
  const rotZ = -Math.sin(theta) * 2;

  // Ring plane - as we approach, rings tilt toward us (compress then open)
  // Mid-approach: edge-on. Late approach: facing us more (opens up).
  const approachTilt = 0.3 + ease * 0.6; // 0.3 edge-ish -> 0.9 open
  const ringScaleY = approachTilt;
  // Rings rotate slightly as viewing angle changes
  const ringPerspective = Math.cos(theta) * 4;

  // Opacity - star stays visible and gets more intense as we approach
  const opacity = 1;

  return {
    x,
    y,
    scale,
    rotZ,
    blur: 0,
    opacity,
    ringScaleY,
    ringPerspective,
  };
}

/**
 * Constellation hero. 81 stars split 27/27/27 across three tiers — teal
 * (high-conviction 90%+), amber (balanced 40–50%), coral (long-tail <10%).
 *
 * Scroll choreography:
 *   • p=0.00–0.12  plain ball of stars, no lines, hero copy readable
 *   • p=0.12–0.30  a few constellation edges fade in (random starchart)
 *   • p=0.22–0.62  stars lerp from Fibonacci sphere → 2D logo arcs
 *   • p=0.55–0.78  ring arcs fade in, the Senthos rings logo resolves
 *   • p=0.72–0.88  rings disperse and fade out
 *   • p=0.88–1.00  Layer B tagline blooms in to an empty stage
 *
 * The end pose traces the real Senthos logo — three concentric arcs
 * opening on the left, each tapering to a terminator dot at the upper-left
 * end. Global rotation gracefully aligns face-on as the morph completes
 * and a slow in-plane spin keeps the logo alive.
 */
function ParticlePlanet({ scrollProgressRef }: { scrollProgressRef: React.MutableRefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    type Star = {
      x0: number; y0: number; z0: number;  // Fibonacci sphere pose
      xR: number; yR: number;              // 2D arc pose (z=0 in logo plane)
      tier: 0 | 1 | 2;
      color: string;
      size: number;
      isTerminator: boolean;               // upper-left arc end — rendered larger
      twSpeed: number;
      twPhase: number;
      sphereLink: number;                  // one forward neighbour; -1 = none
    };

    const STAR_COUNT = 81;
    const PER_TIER = STAR_COUNT / 3;

    // Arc geometry matching /senthos_full.png: three concentric arcs with a
    // gap on the left, outer tier = teal, inner tier = coral. Start and end
    // angles are in canvas convention (0 = right, +π/2 = down).
    const TIER_COLORS = ["#2dd4bf", "#fbbf24", "#fb923c"];
    const TIER_CONFIG = [
      { radius: 1.38, start: -Math.PI * 5 / 6, end:  Math.PI * 5 / 6 }, // outer teal
      { radius: 0.98, start: -Math.PI * 3 / 4, end:  Math.PI * 3 / 4 }, // middle amber
      { radius: 0.58, start: -Math.PI * 2 / 3, end:  Math.PI * 2 / 3 }, // inner coral
    ];

    let seed = 2_198_317;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const stars: Star[] = [];
    const phi = Math.PI * (Math.sqrt(5) - 1);

    for (let i = 0; i < STAR_COUNT; i++) {
      // Sphere pose
      const sy = 1 - (i / (STAR_COUNT - 1)) * 2;
      const sr = Math.sqrt(Math.max(0, 1 - sy * sy));
      const stheta = phi * i;
      const sx = Math.cos(stheta) * sr;
      const sz = Math.sin(stheta) * sr;

      const tier = (i % 3) as 0 | 1 | 2;
      const k = Math.floor(i / 3);
      const cfg = TIER_CONFIG[tier];
      const arcT = k / (PER_TIER - 1);
      const angle = cfg.start + arcT * (cfg.end - cfg.start);
      const xR = Math.cos(angle) * cfg.radius;
      const yR = Math.sin(angle) * cfg.radius;

      stars.push({
        x0: sx, y0: sy, z0: sz,
        xR, yR,
        tier,
        color: TIER_COLORS[tier],
        size: 0.9 + rand() * 1.6,
        isTerminator: k === 0, // upper-left arc end gets the big dot
        twSpeed: 0.45 + rand() * 1.55,
        twPhase: rand() * Math.PI * 2,
        sphereLink: -1,
      });
    }

    // Sparse constellation edges — every other star gets a single short
    // forward edge to its nearest next neighbour. Keeps it "a few lines"
    // instead of a mesh.
    const MAX_EDGE2 = 0.30 * 0.30;
    for (let i = 0; i < STAR_COUNT; i += 2) {
      let bestJ = -1;
      let bestD2 = MAX_EDGE2;
      for (let j = i + 1; j < STAR_COUNT; j++) {
        const dx = stars[i].x0 - stars[j].x0;
        const dy = stars[i].y0 - stars[j].y0;
        const dz = stars[i].z0 - stars[j].z0;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestJ = j; }
      }
      stars[i].sphereLink = bestJ;
    }

    // Ring-phase "next along arc" per star. Because k = floor(i/3), naturally
    // ordered within each tier. Terminator k=0 links to k=1 so the arc draws
    // continuously from the upper-left terminator around to the lower-left tail.
    const ringNext: number[] = new Array(STAR_COUNT).fill(-1);
    const tierGroups: number[][] = [[], [], []];
    for (let i = 0; i < STAR_COUNT; i++) tierGroups[stars[i].tier].push(i);
    for (const g of tierGroups) {
      for (let k = 0; k < g.length - 1; k++) ringNext[g[k]] = g[k + 1];
      // no wraparound — arcs are open on the left
    }

    let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let W = 0, H = 0;
    const resize = () => {
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const smooth = (e0: number, e1: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };

    let raf = 0;
    const t0 = performance.now();

    type Proj = { x: number; y: number; z: number; size: number; color: string; alpha: number; alphaRaw: number; isTerm: boolean };
    const projected: Proj[] = new Array(STAR_COUNT);

    const render = () => {
      const now = performance.now();
      const t = (now - t0) / 1000;
      const progress = Math.max(0, Math.min(1, scrollProgressRef.current));

      ctx.clearRect(0, 0, W, H);

      const minDim = Math.min(W, H);
      const baseR = minDim * 0.22;
      const cx = W / 2;
      // cy glides from below the hero text up to the viewport centre as the
      // morph takes over, so the logo becomes the centrepiece instead of a
      // decoration glued to the bottom of the frame.
      const centring = smooth(0.10, 0.48, progress);
      const cy = H * (0.72 - centring * 0.22);

      // ---- Scroll envelopes (tighter so the logo resolves faster) ----
      const morph      = smooth(0.25, 0.50, progress);
      const edgeFadeIn = smooth(0.10, 0.20, progress);
      const edgeFadeOut = smooth(0.28, 0.44, progress);
      const edgeVis    = edgeFadeIn * (1 - edgeFadeOut);
      const arcVis     = smooth(0.42, 0.55, progress);
      // The moment the morph completes and the arcs resolve, the regular
      // constellation dots dissolve so the frame snaps to the pure logo
      // (three arcs + their terminator dots + centre ring).
      const dotFade    = smooth(0.50, 0.60, progress);
      const disperse   = smooth(0.78, 0.90, progress);
      const bloom      = 1 + smooth(0.0, 0.22, progress) * 0.06;
      const canvasAlpha = 1 - disperse;
      const reach      = 1 + disperse * 2.6;

      // Rotation: 3D yaw+pitch during sphere pose, decaying as morph → 1.
      // Once the logo forms the composition is locked stationary (no spin).
      const rotAmp = 1 - morph * 0.95;
      const yaw   = (t * 0.08 + progress * 0.38) * rotAmp;
      const pitch = (0.18 + Math.sin(t * 0.05) * 0.04) * rotAmp;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

      // ---- Back halo (teal) ----
      const haloR = baseR * 2.5 * bloom * reach;
      const haloA = 0.16 * canvasAlpha;
      const halo = ctx.createRadialGradient(cx, cy, baseR * 0.3, cx, cy, haloR);
      halo.addColorStop(0, `rgba(45, 212, 191, ${haloA.toFixed(3)})`);
      halo.addColorStop(0.55, `rgba(45, 212, 191, ${(haloA * 0.3).toFixed(3)})`);
      halo.addColorStop(1, "rgba(45, 212, 191, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2);

      // Warm centre accent — fades out by the time the logo resolves.
      const warmR = baseR * 1.0 * bloom;
      const warmA = 0.12 * canvasAlpha * (1 - morph * 0.7);
      const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, warmR);
      warm.addColorStop(0, `rgba(255, 237, 170, ${warmA.toFixed(3)})`);
      warm.addColorStop(0.6, `rgba(251, 146, 60, ${(warmA * 0.25).toFixed(3)})`);
      warm.addColorStop(1, "rgba(251, 146, 60, 0)");
      ctx.fillStyle = warm;
      ctx.fillRect(cx - warmR, cy - warmR, warmR * 2, warmR * 2);

      // ---- Project stars using morph-blended position ----
      const oneMinusMorph = 1 - morph;
      for (let i = 0; i < STAR_COUNT; i++) {
        const s = stars[i];
        // Lerp sphere (x0, y0, z0) → ring (xR, yR, 0)
        const mx = s.x0 * oneMinusMorph + s.xR * morph;
        const my = s.y0 * oneMinusMorph + s.yR * morph;
        const mz = s.z0 * oneMinusMorph;

        // Yaw around Y, then pitch around X
        const x1 = mx * cosY + mz * sinY;
        const z1 = -mx * sinY + mz * cosY;
        const y1 = my;
        const y2 = y1 * cosP - z1 * sinP;
        const z2 = y1 * sinP + z1 * cosP;

        const sx = cx + x1 * baseR * bloom * reach;
        const sy = cy + y2 * baseR * bloom * reach;

        // Depth alpha, widened domain so ring pose doesn't clip flat.
        const zn = Math.max(0, Math.min(1, (z2 + 1.4) / 2.8));
        const twink = 0.72 + (Math.sin(t * s.twSpeed + s.twPhase) + 1) * 0.14;
        // Terminators are always bright regardless of depth.
        const depthA = s.isTerminator ? 0.9 : 0.38 + zn * 0.62;
        // alphaRaw ignores the dot fade-out (used by arcs so they don't
        // dim when the constellation dots disappear into the final logo).
        const alphaRaw = depthA * twink * canvasAlpha;
        const dotMul = s.isTerminator ? 1 : (1 - dotFade);
        const alpha = alphaRaw * dotMul;
        // Terminator stars grow bigger as the logo forms.
        const termBoost = s.isTerminator ? 1 + morph * 1.6 : 1;
        const size = s.size * (0.55 + zn * 0.5) * termBoost;
        projected[i] = { x: sx, y: sy, z: z2, size, color: s.color, alpha, alphaRaw, isTerm: s.isTerminator };
      }

      // ---- Sphere-phase edges (off at p=0, peak mid-transition, off again) ----
      if (edgeVis > 0.02) {
        ctx.lineCap = "round";
        ctx.lineWidth = 0.6;
        for (let i = 0; i < STAR_COUNT; i++) {
          const j = stars[i].sphereLink;
          if (j < 0) continue;
          const a = projected[i];
          const b = projected[j];
          const edgeA = Math.min(a.alpha, b.alpha) * 0.5 * edgeVis;
          if (edgeA < 0.015) continue;
          const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          const hex = Math.round(edgeA * 200).toString(16).padStart(2, "0");
          grad.addColorStop(0, a.color + hex);
          grad.addColorStop(1, b.color + hex);
          ctx.strokeStyle = grad;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // ---- Ring arcs (fade in to draw the logo). Uses alphaRaw so the
      // arcs don't dim when the regular constellation dots fade out. ----
      if (arcVis > 0.02) {
        ctx.lineCap = "round";
        for (let i = 0; i < STAR_COUNT; i++) {
          const j = ringNext[i];
          if (j < 0) continue; // no wrap — open arc
          const a = projected[i];
          const b = projected[j];
          const arcA = 0.6 * arcVis * Math.min(a.alphaRaw, b.alphaRaw);
          if (arcA < 0.02) continue;
          ctx.strokeStyle = stars[i].color;
          ctx.lineWidth = 1.4;
          ctx.globalAlpha = arcA;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // ---- Stars (back to front) ----
      const order = Array.from({ length: STAR_COUNT }, (_, i) => i).sort(
        (i, j) => projected[i].z - projected[j].z
      );
      for (const idx of order) {
        const p = projected[idx];
        if (p.alpha < 0.02) continue;
        // Halo — terminators get a bigger, brighter glow so they read as dots.
        const glowMul = p.isTerm ? 6.0 : 4.5;
        const glowR = p.size * glowMul;
        const glowA = p.alpha * (p.isTerm ? 0.75 : 0.55);
        const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        gg.addColorStop(0, `${p.color}${Math.round(glowA * 220).toString(16).padStart(2, "0")}`);
        gg.addColorStop(1, `${p.color}00`);
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
        // Crisp core
        ctx.globalAlpha = Math.min(1, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // White kernel on the brighter stars / terminators
        if (p.isTerm || (p.size > 1.6 && p.alpha > 0.55)) {
          ctx.globalAlpha = Math.min(1, p.alpha * 0.9);
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // ---- Logo centre glyph — tiny teal ring at origin, fades in with arcs ----
      if (arcVis > 0.05) {
        const centreA = arcVis * canvasAlpha;
        ctx.strokeStyle = `rgba(45, 212, 191, ${(centreA * 0.8).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, baseR * 0.06, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [scrollProgressRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * Occasional tiny meteor streaks across the whole viewport. One spawns
 * every 10–15 seconds, lasts about a second, and is intentionally small so
 * it reads as ambience instead of a UI element.
 */
function ShootingStars() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    type Star = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number };
    const stars: Star[] = [];
    let timer: number | null = null;

    const spawn = () => {
      const fromLeft = Math.random() < 0.5;
      const speed = 7 + Math.random() * 3;
      const slope = 0.35 + Math.random() * 0.25;
      stars.push({
        x: fromLeft ? -40 : w + 40,
        y: Math.random() * h * 0.5,
        vx: (fromLeft ? 1 : -1) * speed,
        vy: slope * speed,
        life: 0,
        maxLife: 90 + Math.random() * 50,
      });
    };
    const schedule = () => {
      const delay = 10000 + Math.random() * 5000;
      timer = window.setTimeout(() => { spawn(); schedule(); }, delay);
    };
    timer = window.setTimeout(() => { spawn(); schedule(); }, 4000 + Math.random() * 3000);

    let raf = 0;
    const render = () => {
      ctx.clearRect(0, 0, w, h);
      const isLight = typeof document !== "undefined" &&
        document.documentElement.dataset.theme === "light";
      const trailStart = isLight ? "rgba(13, 148, 136, 0)" : "rgba(165, 243, 252, 0)";
      const trailEndRgb = isLight ? "13, 148, 136" : "240, 255, 252";
      const headRgb = isLight ? "11, 17, 26" : "255, 255, 255";
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];
        s.x += s.vx; s.y += s.vy; s.life++;
        if (s.life > s.maxLife || s.x < -200 || s.x > w + 200 || s.y > h + 200) {
          stars.splice(i, 1);
          continue;
        }
        const a = Math.min(1, s.life / 8) * Math.max(0, 1 - s.life / s.maxLife);
        const tx = s.x - s.vx * 4;
        const ty = s.y - s.vy * 4;
        const grad = ctx.createLinearGradient(tx, ty, s.x, s.y);
        grad.addColorStop(0, trailStart);
        grad.addColorStop(1, `rgba(${trailEndRgb}, ${a})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.fillStyle = `rgba(${headRgb}, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      // Absolute + inset:0 so the canvas fills its parent (Layer A). That
      // way the layer's scroll-driven opacity also fades the stars out
      // along with the sphere.
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}
    />
  );
}

/**
 * Slowly drifting starfield that fills its parent. Designed to live inside
 * Layer A on the landing so it fades out together with the planet and hero
 * copy as the user scrolls past the hero (the parent's opacity attenuates
 * the canvas).
 */
function DriftingStars() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    type Star = { x: number; y: number; r: number; vx: number; vy: number; tw: number; speed: number };
    let stars: Star[] = [];
    let w = 0, h = 0;
    const init = () => {
      w = c.clientWidth; h = c.clientHeight;
      c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.floor((w * h) / 7500);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 0.9 + 0.25,
        vx: (Math.random() - 0.5) * 0.10,
        vy: (Math.random() - 0.5) * 0.06,
        tw: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.0028 + 0.0012,
      }));
    };
    init();
    window.addEventListener("resize", init);
    let raf = 0;
    const readIsLight = () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.theme === "light";
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const isLight = readIsLight();
      // Star rgb: near-white on dark bg, near-teal on light bg so it
      // still reads as "sky".
      const rgb = isLight ? "30, 70, 95" : "220, 235, 250";
      const alphaBoost = isLight ? 0.35 : 0;
      for (const s of stars) {
        s.x += s.vx; s.y += s.vy; s.tw += s.speed;
        if (s.x < -2) s.x = w + 2; else if (s.x > w + 2) s.x = -2;
        if (s.y < -2) s.y = h + 2; else if (s.y > h + 2) s.y = -2;
        const a = (Math.sin(s.tw) + 1) / 2 * 0.45 + 0.18 + alphaBoost;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.9, a)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", init);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * Decorative tilted orbital rings used as a backdrop in the post-star
 * section. Rings rotate slowly with a mix of brand colours so scrolling
 * past feels like drifting through an orbital plane rather than a void.
 */
function OrbitalRings({ size = 1200 }: { size?: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: "50%", left: "50%",
        width: size, height: size,
        transform: "translate(-50%, -50%) perspective(1000px) rotateX(68deg)",
        pointerEvents: "none",
        opacity: 0.85,
      }}
    >
      <style>{`
        @keyframes sthsRingSpin { to { transform: rotate(360deg); } }
        @keyframes sthsRingSpinRev { to { transform: rotate(-360deg); } }
      `}</style>
      {/* Outer teal ring */}
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: "50%",
        border: "1px solid rgba(45, 212, 191, 0.25)",
        boxShadow: "0 0 40px rgba(45, 212, 191, 0.08) inset",
        animation: "sthsRingSpin 240s linear infinite",
      }}>
        <div style={{
          position: "absolute", top: "-4px", left: "50%",
          width: 8, height: 8, borderRadius: "50%",
          background: "#2dd4bf",
          boxShadow: "0 0 14px rgba(45, 212, 191, 0.7)",
          transform: "translateX(-50%)",
        }} />
      </div>
      {/* Mid amber ring */}
      <div style={{
        position: "absolute", inset: "14%",
        borderRadius: "50%",
        border: "1px solid rgba(251, 191, 36, 0.22)",
        animation: "sthsRingSpinRev 180s linear infinite",
      }}>
        <div style={{
          position: "absolute", top: "-3px", left: "20%",
          width: 6, height: 6, borderRadius: "50%",
          background: "#fbbf24",
          boxShadow: "0 0 10px rgba(251, 191, 36, 0.65)",
        }} />
      </div>
      {/* Inner coral ring */}
      <div style={{
        position: "absolute", inset: "28%",
        borderRadius: "50%",
        border: "1px solid rgba(251, 146, 60, 0.2)",
        animation: "sthsRingSpin 130s linear infinite",
      }} />
      {/* Faint innermost hint */}
      <div style={{
        position: "absolute", inset: "40%",
        borderRadius: "50%",
        border: "0.5px dashed rgba(255, 255, 255, 0.08)",
      }} />
    </div>
  );
}

/** Tiny line-glyph icons used in the footer's social row. Each icon is a
 * minimal abstract suggestion of the platform (crossed strokes for X, an
 * angled-bracket motif for GitHub, etc.) so they read as social links
 * without bundling vendor brand assets. */
function SocialIcon({ id }: { id: string }) {
  // Filled marks for X and GitHub; line glyph for Docs.
  if (id === "twitter") return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
  if (id === "github") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 016 0c2.295-1.552 3.3-1.23 3.3-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
  if (id === "docs") return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4h7l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" />
      <path d="M14 4v4h4M9 13h6M9 17h4" />
    </svg>
  );
  return null;
}

const SOCIALS: { id: string; label: string; href: string }[] = [
  { id: "twitter", label: "X",      href: "https://x.com" },
  { id: "github",  label: "GitHub", href: "https://github.com/tharune/senthos-sui" },
  { id: "docs",    label: "Docs",   href: "https://github.com/tharune/senthos-sui#readme" },
];

// Landing-page footer links. Kept in sync with the authenticated
// /app nav — Hedge and Lending were retired, Markets was renamed to
// Portfolio and moved to /app/portfolio, and Constellations (the
// basket grid) is added so the footer covers every live route.
const FOOTER_LINKS: { label: string; href: string }[] = [
  { label: "Portfolio",      href: "/app/portfolio" },
  { label: "Constellations", href: "/app/basket" },
  { label: "Tranches",       href: "/app/tranche" },
  { label: "PPN",            href: "/app/ppn" },
];

function LandingPage({ onEnterApp, onNav }: { onEnterApp:()=>void, onNav:(t:string)=>void }) {
  void onEnterApp; void onNav;
  const isMobile = useMobile();
  // Runway refs for the sticky crossfade hero (ported from laytus landing).
  const wrapRef = useRef<HTMLDivElement|null>(null);
  const layerARef = useRef<HTMLDivElement|null>(null);
  const layerBRef = useRef<HTMLDivElement|null>(null);
  const heroTextRef = useRef<HTMLDivElement|null>(null);
  // Post-runway section refs (Constellations → Risk Tiers → Mechanics → CTA).
  const sectionRefs = useRef<(HTMLElement|null)[]>([]);
  // Fed to ParticlePlanet so its scale/rotation tracks runway scroll.
  const scrollProgressRef = useRef(0);

  // Scroll orchestration:
  //   1. A 260vh scroll runway contains a 100vh sticky frame with two absolute
  //      layers. scrollProgressRef tracks a lerp-damped version of the raw
  //      scroll ratio so scroll-wheel jumps become buttery without losing the
  //      link to the actual page position. The constellation canvas handles
  //      its own fly-through on progress, so Layer A only needs opacity and a
  //      small lift — stacking more transforms would fight the canvas.
  //   2. Post-runway sections fade based on distance from viewport centre with
  //      a generous readable window plus a gentle parallax so copy stays legible.
  useEffect(() => {
    let raf = 0;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const easeInOut = (t: number) => {
      const x = clamp(t, 0, 1);
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    };
    const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

    const tick = () => {
      const wrap = wrapRef.current;
      const a = layerARef.current;
      const b = layerBRef.current;
      const text = heroTextRef.current;
      if (wrap && a && b) {
        const rect = wrap.getBoundingClientRect();
        const range = wrap.offsetHeight - window.innerHeight;
        const targetP = range > 0 ? clamp(-rect.top / range, 0, 1) : 0;
        // Lerp damping — stronger for tiny deltas (tracking) and looser for
        // big scroll-wheel jumps (feels like momentum, not lag).
        const cur = scrollProgressRef.current;
        const delta = targetP - cur;
        const k = Math.abs(delta) > 0.04 ? 0.22 : 0.35;
        const p = cur + delta * k;
        scrollProgressRef.current = p;

        // Hero text dissolves across a longer window so the top copy
        // gradually lifts and fades instead of snapping off the screen.
        if (text) {
          const tFade = 1 - easeInOut(clamp((p - 0.04) / 0.32, 0, 1));
          text.style.opacity = String(tFade);
          const imp = 1 - tFade;
          text.style.transform = `translate(-50%, ${-imp * 40}px)`;
        }
        // Layer A wrapper stays fully lit — the canvas and text children
        // handle their own fades. No stacked opacity to fight with the morph.
        a.style.opacity = "1";
        // Layer B holds off until the planet's arc-resolve phase has
        // completed (p≈0.70). The planet canvas disperses itself at
        // p≈0.78–0.90, so letting the tagline bloom in from 0.72 to 0.96
        // gives the morph a clean, unobstructed stage and then overlaps
        // the tagline with the dispersal gracefully — no more competing
        // copy behind the Senthos arcs while they're resolving.
        const bP = easeInOut(clamp((p - 0.72) / 0.24, 0, 1));
        b.style.opacity = String(bP);
        b.style.transform = `translateY(${(1 - bP) * 24}px)`;
      }

      const vh = window.innerHeight;
      sectionRefs.current.forEach((sec) => {
        if (!sec) return;
        const rect = sec.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const distFromCenter = Math.abs(center - vh / 2);
        // Tighter readable window (0.7 vh either side) so only one
        // section's copy and backdrop art is visible at a time. The
        // previous 0.9vh + pow(0.75) curve kept adjacent sections
        // lingering near 25–30% opacity simultaneously, so the
        // OrbitalRings behind the PRODUCTS section bled up through
        // the MECHANICS and CTA gaps as faint tilted edges — the
        // "cooked" horizontal seam. Steeper pow(1.1) lets sections
        // fully resolve at centre and cleanly dissolve into pure
        // black at the seams.
        const falloff = clamp(1 - distFromCenter / (vh * 0.7), 0, 1);
        sec.style.opacity = String(Math.pow(falloff, 1.1));
        // Halved parallax so text doesn't skate past the eye while reading.
        const parallax = (center - vh / 2) * 0.05;
        sec.style.transform = `translateY(${parallax}px)`;
      });

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{position:"relative",background:"transparent"}}>
      {/* ══ Scroll runway with sticky-frame crossfade ══
           Layer A (sphere + hero copy + shooting stars) fades out;
           Layer B (tagline) fades in. */}
      <div ref={wrapRef} style={{position:"relative",height:"260vh"}}>
        <div style={{position:"sticky",top:0,height:"100vh",overflow:"hidden"}}>

          {/* Layer A — hero with drifting stars + sphere + meteors behind.
               Order matters: stars first (back) → planet → shooting stars on top. */}
          <div
            ref={layerARef}
            style={{position:"absolute",inset:0,zIndex:2,pointerEvents:"auto"}}
          >
            <DriftingStars />
            <ParticlePlanet scrollProgressRef={scrollProgressRef} />
            <ShootingStars />
            {/* Soft teal glow sits inside layer A so it fades with the sphere. */}
            <div
              aria-hidden
              style={{
                position:"absolute",inset:0,pointerEvents:"none",
                background:"radial-gradient(ellipse 60% 50% at 50% 50%, rgba(45, 212, 191, 0.06) 0%, transparent 65%)",
              }}
            />
            {/* Heading block — anchored to top of the viewport, widened so
                 the h1 breaks into at most two lines and never overlaps the
                 constellation sitting in the lower portion of the frame. */}
            <div ref={heroTextRef} style={{
              position:"absolute",
              top: isMobile ? 88 : 120,
              left:"50%",
              transform:"translateX(-50%)",
              width:"100%",
              maxWidth: isMobile ? 600 : 960,
              padding: isMobile ? "0 24px" : "0 48px",
              textAlign:"center",
              zIndex:3,
              willChange:"opacity, transform",
            }}>
              <div style={{fontFamily:FM,fontSize: isMobile ? 9 : 10,letterSpacing:"0.26em",color:C.textMuted,marginBottom:isMobile?14:18,fontWeight:500}}>
                STRUCTURED PREDICTION MARKETS · SUI TESTNET
              </div>
              <h1 style={{fontFamily:FD,fontSize: isMobile ? "clamp(28px, 7vw, 36px)" : "clamp(36px, 3.6vw, 54px)", fontWeight:300, lineHeight:1.06, letterSpacing:"-0.025em", margin:0, color:C.textPrimary, whiteSpace:isMobile?"normal":"nowrap"}}>
                Hundreds of markets, one constellation
              </h1>
              <p style={{fontSize: isMobile ? 13 : 15, lineHeight:1.55, color:C.textSecondary, fontWeight:300, maxWidth:isMobile?440:580, margin:isMobile?"14px auto 0":"18px auto 0", fontFamily:FS}}>
                Senthos wraps hundreds of Polymarket positions into a single Sui testnet position surface. Pick your tier, drop in USDC, sit on it until the legs resolve
              </p>
            </div>
          </div>

          {/* Layer B — tagline revealed as Layer A fades out */}
          <div
            ref={layerBRef}
            style={{
              position:"absolute",inset:0,zIndex:1,
              opacity:0,
              display:"flex",flexDirection:"column",
              alignItems:"center",justifyContent:"center",
              textAlign:"center",padding:"0 2rem",pointerEvents:"auto",
              willChange:"opacity, transform",
            }}
          >
            <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.24em",color:C.tealLight,marginBottom:isMobile?18:22,fontWeight:500}}>
              POWERED BY SENTHOS
            </div>
            <h2 style={{fontFamily:FD,fontSize: isMobile ? "clamp(32px, 8vw, 44px)" : "clamp(44px, 5vw, 68px)", fontWeight:300, lineHeight:1.05, letterSpacing:"-0.03em", margin:0, color:C.textPrimary, maxWidth:780}}>
              One token for the whole <span style={{color:C.tealLight,fontWeight:500}}>thesis</span>
            </h2>
            <p style={{fontSize: isMobile ? 14 : 16, lineHeight:1.65, color:C.textSecondary, fontWeight:300, maxWidth:540, margin:isMobile?"18px auto 0":"22px auto 0", fontFamily:FS}}>
              Stop picking one market at a time. A constellation covers a full view across rates, macro, crypto, and politics, settled in a single on-chain transaction when the legs land
            </p>
          </div>

        </div>
      </div>

      {/* Post-runway sections (Constellations → Risk Tiers → Mechanics →
           Products → CTA). No full-height backdrop gradient here: the
           previous 0→40% black overlay stacked with the sticky runway's
           bg and produced a visible horizontal seam at the sticky/main
           boundary. The body background already carries the base void,
           and each section's own opacity falloff handles the transition
           into Layer B below without extra tint. */}
      <main style={{position:"relative",zIndex:10,pointerEvents:"none",marginTop:"-2vh"}}>
        <section
          ref={el=>{sectionRefs.current[0]=el;}}
          style={{minHeight:"72vh",padding: isMobile ? "0 24px" : "0 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto",willChange:"opacity, transform"}}
        >
          <div style={{margin:"0 auto",maxWidth:700,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.24em",color:C.tealLight,marginBottom:20,fontWeight:500,display:"inline-flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
              01 · CONSTELLATIONS
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize: isMobile ? "clamp(32px, 8vw, 44px)" : "clamp(44px, 5vw, 72px)", fontWeight:200, lineHeight:1.08, letterSpacing:"-0.03em", marginBottom:24, color:C.textPrimary}}>
              A constellation, not a bet
            </h2>
            <p style={{fontSize: isMobile ? 14 : 16, lineHeight:1.65, color:C.textSecondary, fontWeight:300, fontFamily:FS, maxWidth:540, margin:"0 auto"}}>
              Every constellation is a curated bundle of liquid prediction markets. Curators pick the legs, you pick the tier, and the position is diversified before you even deposit
            </p>
          </div>
        </section>
        <section
          ref={el=>{sectionRefs.current[1]=el;}}
          style={{minHeight:"72vh",padding: isMobile ? "0 24px" : "0 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto",willChange:"opacity, transform"}}
        >
          <div style={{margin:"0 auto",maxWidth:720,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.24em",color:C.tealLight,marginBottom:20,fontWeight:500,display:"inline-flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
              02 · RISK TIERS
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize: isMobile ? "clamp(32px, 8vw, 44px)" : "clamp(44px, 5vw, 72px)", fontWeight:200, lineHeight:1.08, letterSpacing:"-0.03em", marginBottom:24, color:C.textPrimary}}>
              Three tiers, three prices
            </h2>
            <p style={{fontSize: isMobile ? 14 : 16, lineHeight:1.65, color:C.textSecondary, fontWeight:300, fontFamily:FS, maxWidth:540, margin:"0 auto 32px"}}>
              Same constellation, three prices. High conviction sits near par so your downside is small, balanced pays roughly double, long-tail pays ten times or more when the legs hit
            </p>
            <div style={{display:"inline-flex",alignItems:"baseline",gap: isMobile ? 20 : 36, fontFamily:FD}}>
              {[
                {tier:"90%+",   label:"High conviction", color:C.tealLight},
                {tier:"40–60%", label:"Balanced",        color:"#fbbf24"},
                {tier:"<10%",   label:"Long-tail",       color:"#fb923c"},
              ].map(t=>(
                <div key={t.tier} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
                  <span style={{fontSize: isMobile ? 26 : 38, fontWeight:300, color:t.color, letterSpacing:"-0.035em", lineHeight:1}}>{t.tier}</span>
                  <span style={{fontFamily:FM, fontSize:10, letterSpacing:"0.14em", color:C.textMuted, textTransform:"uppercase"}}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section
          ref={el=>{sectionRefs.current[2]=el;}}
          style={{minHeight:"72vh",padding: isMobile ? "0 24px" : "0 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto",willChange:"opacity, transform"}}
        >
          <div style={{margin:"0 auto",maxWidth:700,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.24em",color:C.tealLight,marginBottom:20,fontWeight:500,display:"inline-flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
              03 · MECHANICS
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize: isMobile ? "clamp(32px, 8vw, 44px)" : "clamp(44px, 5vw, 72px)", fontWeight:200, lineHeight:1.08, letterSpacing:"-0.03em", marginBottom:24, color:C.textPrimary}}>
              Deposit, hold, auto-settle
            </h2>
            <p style={{fontSize: isMobile ? 14 : 16, lineHeight:1.65, color:C.textSecondary, fontWeight:300, fontFamily:FS, maxWidth:540, margin:"0 auto"}}>
              Deposit USDC, get a constellation token back, and hold. When the last leg resolves on-chain the payout lands in every holder&apos;s wallet and the token burns itself, with no claim window to miss
            </p>
          </div>
        </section>
        <section
          ref={el=>{sectionRefs.current[3]=el;}}
          style={{minHeight:"78vh",padding: isMobile ? "0 24px" : "0 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto",willChange:"opacity, transform"}}
        >
          {/* OrbitalRings backdrop removed. The tilted ellipse kept
              bleeding into the section seam above no matter how the
              mask was tuned; rather than keep chasing the clip, the
              PRODUCTS section now sits on the same clean black void
              as the other post-hero sections and lets the product
              grid carry the visual weight on its own. */}
          <div style={{margin:"0 auto",maxWidth:1180,textAlign:"center",position:"relative",zIndex:1,width:"100%"}}>
            <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.24em",color:C.tealLight,marginBottom:20,fontWeight:500,display:"inline-flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
              04 · PRODUCTS
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize: isMobile ? "clamp(32px, 8vw, 44px)" : "clamp(44px, 5vw, 72px)", fontWeight:200, lineHeight:1.08, letterSpacing:"-0.03em", marginBottom:20, color:C.textPrimary}}>
              One position, four products
            </h2>
            <p style={{fontSize: isMobile ? 14 : 16, lineHeight:1.65, color:C.textSecondary, fontWeight:300, fontFamily:FS, maxWidth:isMobile?560:760, margin:"0 auto 48px", whiteSpace:isMobile?"normal":"nowrap"}}>
              A constellation is the position. Every other product is something you can do with it
            </p>
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(4, minmax(0, 1fr))",gap:isMobile?10:11,textAlign:"left",maxWidth:1040,margin:"0 auto"}}>
              {[
                {n:"01", t:"Portfolio construction", d:"Pick the markets, weight them how you want, mint a constellation for others to buy into",     color:"#a5f3fc"},
                {n:"02", t:"Constellations",         d:"Hold a curated bundle as one token, settled in one transaction when the legs resolve",         color:C.tealLight},
                {n:"03", t:"Tranches",               d:"Buy the same constellation at three prices, trading how much downside you'll hold for upside", color:"#fbbf24"},
                {n:"04", t:"PPNs",                   d:"Principal-protected notes where yield pays the premium and the constellation keeps the upside", color:"#fb923c"},
              ].map(p=>(
                <div key={p.n} className="senthos-card" style={{
                  padding: isMobile ? "22px 22px 20px" : "26px 24px 22px",
                  background: C.cardGradient,
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  minHeight: isMobile ? "auto" : 176,
                  transition: `border-color 0.2s ${EASE}, background 0.2s ${EASE}, transform 0.2s ${EASE}`,
                }}
                  onMouseEnter={e=>{
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = `${p.color}55`;
                    el.style.background = C.cardGradientHover;
                    el.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={e=>{
                    const el = e.currentTarget as HTMLElement;
                    el.style.borderColor = C.border;
                    el.style.background = C.cardGradient;
                    el.style.transform = "translateY(0)";
                  }}
                >
                  <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.18em",color:p.color,marginBottom:20,opacity:0.9}}>{p.n}</div>
                  <div style={{fontFamily:FD,fontSize:17,fontWeight:500,color:C.textPrimary,marginBottom:10,letterSpacing:"-0.015em",lineHeight:1.25}}>{p.t}</div>
                  <div style={{fontFamily:FS,fontSize:13,lineHeight:1.55,color:C.textSecondary}}>{p.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section
          ref={el=>{sectionRefs.current[4]=el;}}
          style={{minHeight:"68vh",padding: isMobile ? "0 24px" : "0 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto",willChange:"opacity, transform"}}
        >
          <div style={{margin:"0 auto",maxWidth:720,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.24em",color:C.tealLight,marginBottom:20,fontWeight:500,display:"inline-flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
              05 · ENTER
              <span aria-hidden style={{width:22,height:1,background:C.tealLight,opacity:0.45}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize: isMobile ? "clamp(36px, 9vw, 56px)" : "clamp(56px, 5.6vw, 88px)", fontWeight:200, lineHeight:1.02, letterSpacing:"-0.04em", marginBottom:isMobile?20:24, color:C.textPrimary}}>
              Explore <span style={{fontWeight:500, color:C.tealLight}}>markets</span>
            </h2>
            <p style={{fontSize: isMobile ? 14 : 16, lineHeight:1.6, color:C.textSecondary, fontWeight:300, fontFamily:FS, maxWidth:520, margin:isMobile?"0 auto 28px":"0 auto 36px"}}>
              Pick a constellation, deposit USDC, and watch it settle on-chain
            </p>
            <a href="/app" style={{
              display:"inline-flex", alignItems:"center", gap:8,
              padding: isMobile ? "13px 26px" : "15px 32px",
              borderRadius:10,
              fontSize: isMobile ? 14 : 15, fontWeight:600,
              background:C.tealLight, color:"#001814",
              textDecoration:"none",
              letterSpacing:"0.02em", fontFamily:FD,
              boxShadow:`0 0 0 1px ${C.tealLight}, 0 14px 40px rgba(45, 212, 191, 0.18)`,
              transition:`transform 0.2s ${EASE}, background 0.2s ${EASE}, box-shadow 0.2s ${EASE}`,
            }}
              onMouseEnter={e=>{
                (e.currentTarget as HTMLElement).style.background = C.teal;
                (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 1px ${C.tealLight}, 0 18px 48px rgba(45, 212, 191, 0.28)`;
              }}
              onMouseLeave={e=>{
                (e.currentTarget as HTMLElement).style.background = C.tealLight;
                (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 1px ${C.tealLight}, 0 14px 40px rgba(45, 212, 191, 0.18)`;
              }}
            >
              Explore markets →
            </a>
          </div>
        </section>
        <footer style={{
          padding: isMobile ? "16px 20px" : "18px 32px",
          borderTop:`0.5px solid ${C.border}`,
          display:"flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "flex-start" : "center",
          justifyContent:"space-between",
          gap: isMobile ? 14 : 20,
          flexWrap:"wrap",
          position:"relative", zIndex:10,
          background:C.headerBg, backdropFilter:"blur(12px)",
          pointerEvents:"auto",
        }}>
          {/* Left: brand + social icon row */}
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <img src="/senthos_full.png" alt="Senthos" style={{width:22,height:22,display:"block",flexShrink:0}} />
              <span style={{fontFamily:FD,fontSize:13,fontWeight:600,color:C.textPrimary,letterSpacing:"0.14em"}}>
                SENTHOS
              </span>
            </div>
            <span style={{fontFamily:FM,fontSize:10,color:C.textMuted,letterSpacing:"0.14em"}}>
              SUI {(process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet").toUpperCase()}
            </span>
            <div style={{display:"flex",alignItems:"center",gap:2,marginLeft:isMobile?0:6}}>
              {SOCIALS.map(s => (
                <a
                  key={s.id}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  title={s.label}
                  style={{
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    width:28,height:28,borderRadius:999,
                    color:C.textSecondary,textDecoration:"none",
                    transition:`color 0.15s ${EASE}, background 0.15s ${EASE}`,
                  }}
                  onMouseEnter={e=>{
                    (e.currentTarget as HTMLElement).style.color = C.textPrimary;
                    (e.currentTarget as HTMLElement).style.background = "rgba(45, 212, 191, 0.08)";
                  }}
                  onMouseLeave={e=>{
                    (e.currentTarget as HTMLElement).style.color = C.textSecondary;
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <SocialIcon id={s.id} />
                </a>
              ))}
            </div>
          </div>

          {/* Right: product nav pills */}
          <nav aria-label="Footer navigation" style={{display:"flex",alignItems:"center",gap:2,flexWrap:"wrap"}}>
            {FOOTER_LINKS.map(l => (
              <a
                key={l.label}
                href={l.href}
                style={{
                  display:"inline-flex",alignItems:"center",height:26,
                  padding:"0 12px",borderRadius:999,
                  fontFamily:FM,fontSize:11,fontWeight:500,letterSpacing:"0.04em",
                  color:C.textSecondary,textDecoration:"none",
                  transition:`color 0.15s ${EASE}, background 0.15s ${EASE}`,
                }}
                onMouseEnter={e=>{
                  (e.currentTarget as HTMLElement).style.color = C.textPrimary;
                  (e.currentTarget as HTMLElement).style.background = C.border;
                }}
                onMouseLeave={e=>{
                  (e.currentTarget as HTMLElement).style.color = C.textSecondary;
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Full-width disclaimer row */}
          <div style={{
            width:"100%",
            paddingTop:12,
            borderTop:`0.5px solid ${C.border}`,
            fontFamily:FM,fontSize:10,color:C.textMuted,
            lineHeight:1.6,letterSpacing:"0.02em",
          }}>
            <span style={{fontWeight:600,letterSpacing:"0.08em",marginRight:6}}>DISCLAIMER</span>
            Senthos is a hackathon project deployed locally on Sui testnet for this build. It is not a financial product, a securities offering, or investment advice, and no real capital is routed through any of its flows. There are no plans to deploy to mainnet, issue a token, or continue maintenance after the event. All displayed prices, payoffs, and yields are sandbox simulations.
          </div>
        </footer>
      </main>
      {/* STALE_OLD_SECTIONS_START */}
      <div style={{display:"none"}}>
        <section style={{minHeight:"100vh",padding:isMobile?"100px 24px 80px":"120px 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto"}}>
          <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 60% 55% at 50% 50%, ${C.bg} 0%, ${C.edgeFade} 50%, transparent 85%)`,pointerEvents:"none",zIndex:2}} />
          <div style={{margin:"0 auto",maxWidth:680,position:"relative",zIndex:5,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:isMobile?10:11,letterSpacing:"0.22em",color:C.textMuted,marginBottom:16,display:"flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span style={{width:28,height:1,background:"currentColor"}} />
              Chapter 01 · Constellations
              <span style={{width:28,height:1,background:"currentColor"}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize:isMobile?"clamp(32px, 8vw, 44px)":"clamp(40px, 5vw, 62px)",fontWeight:200,lineHeight:1.08,letterSpacing:"-0.025em",marginBottom:28,color:C.textPrimary}}>
              Not a single bet. A <span style={{fontWeight:500,background:`linear-gradient(90deg, ${C.tealLight} 0%, #a5f3fc 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>constellation</span> of them.
            </h2>
            <p style={{fontSize:isMobile?14:16,lineHeight:1.7,color:C.textSecondary,fontWeight:300,marginBottom:18,fontFamily:FS,maxWidth:560,margin:"0 auto 18px"}}>
              Betting on one prediction market is a coin flip. A Senthos Constellation bundles 10 or more high-liquidity positions into a single basket token, spreading exposure across uncorrelated outcomes.
            </p>
            <p style={{fontSize:isMobile?14:16,lineHeight:1.7,color:C.textSecondary,fontWeight:300,marginBottom:18,fontFamily:FS,maxWidth:560,margin:"0 auto 40px"}}>
              You don&apos;t pick the positions. Our structurers do. You pick the risk profile, and buy the whole sky at once.
            </p>
            <div style={{marginTop:40,padding:isMobile?18:24,background:C.surface,border:"1px solid rgba(45, 212, 191, 0.12)",borderRadius:14,backdropFilter:"blur(16px)",textAlign:"left",maxWidth:520,margin:"40px auto 0"}}>
              <div style={{fontFamily:FM,fontSize:10,letterSpacing:"0.18em",color:C.textMuted,marginBottom:14}}>EXAMPLE · STHS-90-0515</div>
              <div style={{fontFamily:FM,fontSize:isMobile?13:15,fontWeight:500,color:C.tealLight,marginBottom:14}}>10 positions · Conservative tier · Resolves May 15</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[
                  ["Fed holds rates in June","91%"],
                  ["US avoids recession 2025","88%"],
                  ["BTC above $80k by May","92%"],
                  ["NVIDIA beats Q1 earnings","87%"],
                  ["Gold above $2,400/oz","90%"],
                ].map(([l,p],i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,fontSize:isMobile?12:13,color:C.textSecondary,padding:"6px 0",borderBottom:i<4?"0.5px solid rgba(255, 255, 255, 0.04)":"none",fontFamily:FS}}>
                    <span>{l}</span>
                    <span style={{fontFamily:FM,color:C.tealLight,fontSize:isMobile?11:12,marginLeft:"auto",letterSpacing:"0.04em"}}>{p}</span>
                  </div>
                ))}
                <div style={{fontSize:isMobile?12:13,color:C.textMuted,opacity:0.6,padding:"6px 0",fontFamily:FS}}>+ 5 more positions</div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3 - Tiers */}
        <section style={{minHeight:"100vh",padding:isMobile?"100px 24px 80px":"120px 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto"}}>
          <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 60% 55% at 50% 50%, ${C.bg} 0%, ${C.edgeFade} 50%, transparent 85%)`,pointerEvents:"none",zIndex:2}} />
          <div style={{margin:"0 auto",maxWidth:680,position:"relative",zIndex:5,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:isMobile?10:11,letterSpacing:"0.22em",color:C.textMuted,marginBottom:16,display:"flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span style={{width:28,height:1,background:"currentColor"}} />
              Chapter 02 · Risk tiers
              <span style={{width:28,height:1,background:"currentColor"}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize:isMobile?"clamp(32px, 8vw, 44px)":"clamp(40px, 5vw, 62px)",fontWeight:200,lineHeight:1.08,letterSpacing:"-0.025em",marginBottom:28,color:C.textPrimary}}>
              Three orbits. Three <span style={{fontWeight:500,background:`linear-gradient(90deg, ${C.tealLight} 0%, #a5f3fc 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>risk profiles</span>.
            </h2>
            <p style={{fontSize:isMobile?14:16,lineHeight:1.7,color:C.textSecondary,fontWeight:300,marginBottom:40,fontFamily:FS,maxWidth:560,margin:"0 auto 40px"}}>
              Each constellation lives on one of three rings, defined by its weighted probability. Closer to the star means safer; further means bigger payout.
            </p>
            <div style={{display:"grid",gridTemplateColumns:"1fr",gap:14,marginTop:40,textAlign:"left",maxWidth:560,margin:"40px auto 0"}}>
              {[
                {tier:90,label:"Conservative",sub:"STHS-90",desc:"High-probability basket. Issue price around $0.90. Built for capital preservation with small upside.",color:C.tealLight},
                {tier:70,label:"Balanced",sub:"STHS-70",desc:"Medium conviction. Issue price around $0.70. Meaningful payout with manageable downside.",color:"#fbbf24"},
                {tier:50,label:"High conviction",sub:"STHS-50",desc:"Near even-odds. Issue price around $0.50. Maximum payout potential for directional views.",color:"#fb923c"},
              ].map(t=>(
                <div key={t.tier} style={{padding:isMobile?"18px 20px":"22px 24px",background:C.surface,border:"1px solid rgba(45, 212, 191, 0.1)",borderRadius:16,backdropFilter:"blur(14px)",position:"relative",overflow:"hidden",transition:`all 0.3s ${EASE}`}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-3px)";(e.currentTarget as HTMLElement).style.borderColor="rgba(45, 212, 191, 0.25)";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(0)";(e.currentTarget as HTMLElement).style.borderColor="rgba(45, 212, 191, 0.1)";}}
                >
                  <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:t.color,opacity:0.7}} />
                  <div style={{display:"flex",alignItems:"baseline",gap:14,marginBottom:8}}>
                    <div style={{fontFamily:FD,fontSize:isMobile?30:38,fontWeight:300,color:t.color,letterSpacing:"-0.035em",lineHeight:1}}>{t.tier}%</div>
                    <div style={{fontSize:isMobile?13:15,color:C.textPrimary,fontWeight:500,letterSpacing:"-0.005em",fontFamily:FD}}>{t.label}</div>
                    <div style={{marginLeft:"auto",fontFamily:FM,fontSize:isMobile?10:11,color:C.textMuted,letterSpacing:"0.08em"}}>{t.sub}</div>
                  </div>
                  <p style={{fontSize:isMobile?12:13,color:C.textSecondary,lineHeight:1.55,fontFamily:FS}}>{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 4 - Mechanics */}
        <section style={{minHeight:"100vh",padding:isMobile?"100px 24px 80px":"120px 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto"}}>
          <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 60% 55% at 50% 50%, ${C.bg} 0%, ${C.edgeFade} 50%, transparent 85%)`,pointerEvents:"none",zIndex:2}} />
          <div style={{margin:"0 auto",maxWidth:680,position:"relative",zIndex:5,textAlign:"center"}}>
            <div style={{fontFamily:FM,fontSize:isMobile?10:11,letterSpacing:"0.22em",color:C.textMuted,marginBottom:16,display:"flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span style={{width:28,height:1,background:"currentColor"}} />
              Chapter 03 · Mechanics
              <span style={{width:28,height:1,background:"currentColor"}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize:isMobile?"clamp(32px, 8vw, 44px)":"clamp(40px, 5vw, 62px)",fontWeight:200,lineHeight:1.08,letterSpacing:"-0.025em",marginBottom:28,color:C.textPrimary}}>
              Deposit. Hold. <span style={{fontWeight:500,background:`linear-gradient(90deg, ${C.tealLight} 0%, #a5f3fc 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>Collect</span>.
            </h2>
            <p style={{fontSize:isMobile?14:16,lineHeight:1.7,color:C.textSecondary,fontWeight:300,marginBottom:40,fontFamily:FS,maxWidth:560,margin:"0 auto 40px"}}>
              No claiming, no manual steps, no unwinding trades. The token is the position, and it auto-resolves.
            </p>
            <div style={{display:"flex",flexDirection:"column",gap:isMobile?22:28,marginTop:40,textAlign:"left",maxWidth:560,margin:"40px auto 0"}}>
              {[
                ["01","Pick a tier, deposit USDC","Choose your risk level. Your deposit buys the underlying prediction market positions at issuance. A 0.5% structuring fee is taken once."],
                ["02","Receive an STHS token","One token lands in your wallet. It tracks the live net asset value of the constellation. You can sell it on Jupiter at any time, or hold through resolution."],
                ["03","Collect when markets settle","When the last position resolves, USDC is sent directly to every holder's wallet. Tokens burn. Nothing to claim."],
              ].map(([n,t,d],i)=>(
                <div key={n} style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:isMobile?18:28,alignItems:"flex-start"}}>
                  <div style={{width:isMobile?40:48,height:isMobile?40:48,borderRadius:"50%",border:"1px solid rgba(45, 212, 191, 0.3)",background:"rgba(45, 212, 191, 0.08)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FM,fontSize:isMobile?12:13,color:C.tealLight,fontWeight:500,flexShrink:0,position:"relative"}}>
                    {n}
                    {i<2 && <div style={{position:"absolute",top:"100%",left:"50%",width:1,height:isMobile?30:40,background:`linear-gradient(to bottom, rgba(45, 212, 191, 0.3), transparent)`}} />}
                  </div>
                  <div>
                    <h3 style={{fontSize:isMobile?16:19,fontWeight:500,marginBottom:8,letterSpacing:"-0.01em",color:C.textPrimary,fontFamily:FD}}>{t}</h3>
                    <p style={{fontSize:isMobile?13:14,color:C.textSecondary,lineHeight:1.65,maxWidth:440,fontFamily:FS}}>{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 5 - Launch */}
        <section style={{minHeight:"100vh",padding:isMobile?"80px 24px":"140px 40px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",pointerEvents:"auto"}}>
          <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 60% 55% at 50% 50%, ${C.bg} 0%, ${C.edgeFade} 50%, transparent 85%)`,pointerEvents:"none",zIndex:2}} />
          <div style={{margin:"0 auto",maxWidth:720,textAlign:"center",position:"relative",zIndex:5}}>
            <div style={{fontFamily:FM,fontSize:isMobile?10:11,letterSpacing:"0.22em",color:C.textMuted,marginBottom:16,display:"flex",alignItems:"center",gap:12,justifyContent:"center"}}>
              <span style={{width:28,height:1,background:"currentColor"}} />
              Final approach
              <span style={{width:28,height:1,background:"currentColor"}} />
            </div>
            <h2 style={{fontFamily:FD,fontSize:isMobile?"clamp(36px, 9vw, 52px)":"clamp(48px, 6vw, 84px)",fontWeight:200,lineHeight:1.08,letterSpacing:"-0.025em",marginBottom:28,color:C.textPrimary,textAlign:"center"}}>
              Your orbit starts <span style={{fontWeight:500,background:`linear-gradient(90deg, ${C.tealLight} 0%, #a5f3fc 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>here</span>.
            </h2>
            <p style={{fontSize:isMobile?14:16,lineHeight:1.7,color:C.textSecondary,fontWeight:300,marginBottom:40,maxWidth:520,margin:"0 auto 40px",textAlign:"center",fontFamily:FS}}>
              Five constellations live today. Three risk tiers. One token per basket.
            </p>
            <button onClick={()=>{ window.location.href="/app"; }} style={{
              display:"inline-flex",alignItems:"center",gap:8,
              padding:isMobile?"14px 26px":"16px 32px",borderRadius:100,
              fontSize:isMobile?14:15,fontWeight:600,
              background:`linear-gradient(135deg, ${C.teal} 0%, ${C.tealLight} 100%)`,
              color:"#000",border:"none",cursor:"pointer",
              letterSpacing:"0.01em",fontFamily:FD,
              transition:`all 0.3s ${EASE}`,position:"relative",overflow:"hidden",
              boxShadow:`0 0 0 1px rgba(45, 212, 191, 0.3), 0 8px 30px rgba(45, 212, 191, 0.3)`,
            }}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-2px)";(e.currentTarget as HTMLElement).style.boxShadow=`0 0 0 1px rgba(45, 212, 191, 0.5), 0 14px 40px rgba(45, 212, 191, 0.5)`;}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(0)";(e.currentTarget as HTMLElement).style.boxShadow=`0 0 0 1px rgba(45, 212, 191, 0.3), 0 8px 30px rgba(45, 212, 191, 0.3)`;}}
            >
              Explore Markets →
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer style={{padding:isMobile?"24px 20px":"40px 64px",borderTop:"0.5px solid rgba(45, 212, 191, 0.08)",display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:"center",fontFamily:FM,fontSize:isMobile?10:11,color:C.textMuted,letterSpacing:"0.08em",gap:10,position:"relative",zIndex:10,background:C.headerBg,backdropFilter:"blur(12px)",pointerEvents:"auto"}}>
          <div>SENTHOS © 2025 · STRUCTURED PREDICTIONS</div>
          <div>SUI TESTNET · v0.1.0</div>
        </footer>

      </div>
      {/* STALE_OLD_SECTIONS_END */}
    </div>
  );
}

type TabId="home"|"markets"|"constellations"|"portfolio"|"detail";

export default function App() {
  const [tab,setTab]=useState<TabId>("home");
  const [selectedBundle,setSelectedBundle]=useState<Bundle|null>(null);
  const [fromTab,setFromTab]=useState("markets");
  const [walletConnected,setWalletConnected]=useState(false);
  const [showWalletModal,setShowWalletModal]=useState(false);

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [demoMode, setDemoMode] = useState(true);
  const [demoUsdc, setDemoUsdc] = useState(DEMO_STARTING_USDC);
  const [demoPortfolio, setDemoPortfolio] = useState<Position[]>([]);
  const [demoVaults, setDemoVaults] = useState<VaultPos[]>([]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const activePortfolio = demoMode ? demoPortfolio : STATIC_PORTFOLIO;
  const activeVaults = demoMode ? demoVaults : STATIC_VAULT_POSITIONS;
  const activeUsdc = demoMode ? demoUsdc : STATIC_USDC_BALANCE;

  const handleSelect=(bundle:Bundle,from:string)=>{setSelectedBundle(bundle);setFromTab(from);setTab("detail");};
  const handleBack=()=>setTab(fromTab as TabId);

  const handleDemoDeposit = (bundleId:string, usdcAmount:number) => {
    const bundle = BUNDLES.find(b=>b.id===bundleId); if (!bundle) return;
    const tokensReceived = (usdcAmount * 0.995) / bundle.nav;
    setDemoUsdc(prev => Math.max(0, prev - usdcAmount));
    setDemoPortfolio(prev => {
      const existing = prev.find(p=>p.id===bundleId);
      if (existing) {
        const newQty = existing.qty + tokensReceived;
        const newAvgCost = ((existing.qty * existing.avgCost) + (tokensReceived * bundle.nav)) / newQty;
        return prev.map(p => p.id===bundleId ? {id:bundleId, qty:newQty, avgCost:newAvgCost} : p);
      }
      return [...prev, {id:bundleId, qty:tokensReceived, avgCost:bundle.nav}];
    });
  };

  const handleDemoPpnDeposit = (bundleId:string, usdcAmount:number) => {
    const bundle = BUNDLES.find(b=>b.id===bundleId); if (!bundle) return;
    const vaultAmount = usdcAmount * 0.93;
    const basketAmount = usdcAmount * 0.07;
    const tokensReceived = (basketAmount * 0.995) / bundle.nav;

    setDemoUsdc(prev => Math.max(0, prev - usdcAmount));
    setDemoPortfolio(prev => {
      const existing = prev.find(p=>p.id===bundleId);
      if (existing) {
        const newQty = existing.qty + tokensReceived;
        const newAvgCost = ((existing.qty * existing.avgCost) + (tokensReceived * bundle.nav)) / newQty;
        return prev.map(p => p.id===bundleId ? {id:bundleId, qty:newQty, avgCost:newAvgCost} : p);
      }
      return [...prev, {id:bundleId, qty:tokensReceived, avgCost:bundle.nav}];
    });
    setDemoVaults(prev => {
      const vaultId = `VAULT-${bundleId.split("-")[2]}`;
      const existing = prev.find(v=>v.id===vaultId);
      if (existing) {
        return prev.map(v => v.id===vaultId ? {...v, principal: v.principal + vaultAmount} : v);
      }
      return [...prev, {
        id: vaultId,
        label: "Meteora vault",
        principal: vaultAmount,
        yieldEarned: 0,
        apy: 8.4,
        daysLeft: bundle.daysLeft,
        daysTotal: bundle.daysLeft + 30,
        resolveDate: bundle.date,
      }];
    });
  };

  const handleResetDemo = () => {
    setDemoUsdc(DEMO_STARTING_USDC);
    setDemoPortfolio([]);
    setDemoVaults([]);
    setShowResetConfirm(false);
  };

  return (
    <MobileCtx.Provider value={isMobile}>
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:${C.bg};}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        input[type=range]{accent-color:${C.teal};}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(45, 212, 191, 0.15);border-radius:2px;}
        ::-webkit-scrollbar-thumb:hover{background:rgba(45, 212, 191, 0.3);}
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes ctaShine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes senthosOrbitSlow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes senthosOrbitRev {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        .senthos-orbit-slow { animation: senthosOrbitSlow 80s linear infinite; }
        .senthos-orbit-med  { animation: senthosOrbitRev 120s linear infinite; }
        .senthos-orbit-fast { animation: senthosOrbitSlow 160s linear infinite; }
      `}</style>

      {/* Persistent subtle starfield — only on app/dashboard tabs. The
           landing tab uses its own drifting starfield inside Layer A so it
           fades together with the sphere when the user scrolls past the hero. */}
      {tab !== "home" && <StarfieldBG />}

      {/* Top Nav — Aave/Lido-style: flat, well-spaced, single CTA. */}
      <nav style={{
        position:"fixed",top:0,left:0,right:0,zIndex:100,
        height: isMobile ? 58 : 64,
        padding: isMobile ? "0 18px" : "0 32px",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)",
        background:C.headerBg,
        borderBottom:`0.5px solid ${C.border}`,
      }}>
        {/* LEFT: logo + nav links */}
        <div style={{display:"flex",alignItems:"center",gap:isMobile?0:36}}>
          <div onClick={()=>{setTab("home");if(isMobile)setSidebarOpen(false);}} style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer"}}>
            <img src="/senthos_full.png" alt="Senthos" style={{width:isMobile?24:26,height:isMobile?24:26,display:"block",flexShrink:0}} />
            <div style={{fontSize:isMobile?12:14,fontWeight:600,color:C.textPrimary,fontFamily:FD,letterSpacing:"0.14em"}}>SENTHOS</div>
          </div>

          {!isMobile && (
            <ul style={{display:"flex",gap:28,listStyle:"none",margin:0,padding:0,alignItems:"center"}}>
              {[
                {id:"home",      label:"Home",           href:"/"},
                {id:"portfolio", label:"Portfolio",      href:"/app/portfolio"},
                {id:"basket",    label:"Constellations", href:"/app/basket"},
                {id:"tranches",  label:"Tranches",       href:"/app/tranche"},
                {id:"ppn",       label:"PPN",            href:"/app/ppn"},
              ].map(n=>{
                const isActive = n.id === "home" && tab === "home";
                return (
                  <li key={n.id}>
                    <button onClick={()=>{ if(n.href==="/") setTab("home"); else window.location.href=n.href; }} style={{
                      background:"transparent",
                      color: isActive ? C.textPrimary : C.textSecondary,
                      border:"none",
                      padding:"6px 0",
                      fontSize:13, fontWeight:400, fontFamily:FD, letterSpacing:"0.01em",
                      cursor:"pointer",
                      transition:`color 0.15s ${EASE}`,
                      position:"relative",
                    }}
                      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color=C.textPrimary;}}
                      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color=isActive?C.textPrimary:C.textSecondary;}}
                    >
                      {n.label}
                      {isActive && (
                        <span style={{position:"absolute",left:0,right:0,bottom:-4,height:1,background:C.tealLight}} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RIGHT: theme toggle + Explore markets CTA + mobile hamburger */}
        <div style={{display:"flex",alignItems:"center",gap:isMobile?8:10}}>
          <ThemeToggle />
          <a
            href="/app"
            style={{
              display:"inline-flex",alignItems:"center",gap:6,
              fontSize: isMobile ? 12 : 13, fontWeight: 600,
              padding: isMobile ? "8px 14px" : "9px 18px",
              borderRadius: 8,
              background: C.tealLight,
              color: "#001814",
              border: "none",
              textDecoration: "none",
              letterSpacing: "0.01em", fontFamily: FD,
              transition: `background 0.15s ${EASE}`,
            }}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=C.teal;}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=C.tealLight;}}
          >
            Explore markets
          </a>
          {isMobile && (
            <button onClick={()=>setSidebarOpen(!sidebarOpen)} aria-label="menu" style={{
              background:"transparent",
              borderTop:`0.5px solid ${C.border}`,
              borderRight:`0.5px solid ${C.border}`,
              borderBottom:`0.5px solid ${C.border}`,
              borderLeft:`0.5px solid ${C.border}`,
              borderRadius:8,
              padding:"8px 10px",cursor:"pointer",color:C.textPrimary,
              fontSize:16,lineHeight:1,minWidth:38,display:"flex",alignItems:"center",justifyContent:"center",
            }}>{sidebarOpen?"✕":"☰"}</button>
          )}
        </div>
      </nav>

      {isMobile && sidebarOpen && (
        <>
          <div onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:90,backdropFilter:"blur(2px)"}} />
          <div style={{
            position:"fixed",top:58,right:12,left:12,zIndex:95,
            background:C.card,backdropFilter:"blur(16px)",
            border:`0.5px solid ${C.border}`,borderRadius:14,
            padding:"10px 8px",
            animation:`slideDown 0.25s ${EASE}`,
            boxShadow:"0 20px 60px rgba(0,0,0,0.5)",
          }}>
            {[
              {id:"home",      label:"Home",           href:"/"},
              {id:"portfolio", label:"Portfolio",      href:"/app/portfolio"},
              {id:"basket",    label:"Constellations", href:"/app/basket"},
              {id:"tranches",  label:"Tranches",       href:"/app/tranche"},
              {id:"ppn",       label:"PPN",            href:"/app/ppn"},
            ].map(n=>(
              <a key={n.id} href={n.href} onClick={()=>setSidebarOpen(false)} style={{
                display:"block",width:"100%",textAlign:"left",
                padding:"12px 14px",borderRadius:10,textDecoration:"none",
                color:C.textPrimary,
                fontSize:14,fontWeight:400,fontFamily:FD,letterSpacing:"0.01em",
                marginBottom:2,
              }}>{n.label}</a>
            ))}
          </div>
        </>
      )}

      <div style={{
        position:"relative",zIndex:1,
        minHeight:"100vh",
        paddingTop: tab==="home" ? 0 : (isMobile ? 70 : 78),
      }}>
        {tab==="home" && <LandingPage onEnterApp={()=>setTab("markets")} onNav={(t)=>setTab(t as TabId)} />}
        {tab!=="home" && (
          <div style={{maxWidth:1400,margin:"0 auto",padding: isMobile ? "8px 16px 24px" : "16px 36px 32px"}}>
            {tab==="markets"&&<MarketsPage onSelect={handleSelect} />}
            {tab==="constellations"&&<ConstellationsPage onSelect={handleSelect} />}
            {tab==="detail"&&selectedBundle&&<DetailPage bundle={selectedBundle} fromTab={fromTab} onBack={handleBack} demoMode={demoMode} demoUsdc={demoUsdc} onDemoDeposit={handleDemoDeposit} onDemoPpnDeposit={handleDemoPpnDeposit} />}
            {tab==="portfolio"&&<PortfolioPage onSelect={handleSelect} portfolio={activePortfolio} vaultPositions={activeVaults} usdcBalance={activeUsdc} demoMode={demoMode} />}
          </div>
        )}
      </div>

      {showWalletModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={()=>setShowWalletModal(false)}>
          <div style={{background:C.surface,border:`0.5px solid ${C.border}`,borderRadius:20,width:360,overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"18px 24px",borderBottom:`0.5px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:15,fontWeight:600,color:C.textPrimary,fontFamily:FD}}>Connect wallet</span>
              <button onClick={()=>setShowWalletModal(false)} style={{background:"none",border:"none",color:C.textSecondary,cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
            </div>
            <div style={{padding:12}}>
              {[
                {name:"Sui Wallet",sub:"Configured",color:"#4da2ff",initials:"SW",available:true,url:""},
                {name:"Suiet",sub:"Install",color:"#1f8fff",initials:"Su",available:false,url:"https://suiet.app/"},
                {name:"Ethos",sub:"Install",color:"#7c5cff",initials:"Et",available:false,url:"https://ethoswallet.xyz/"},
              ].map(w=>(
                <a key={w.name} href={!w.available?w.url:undefined} target={!w.available?"_blank":undefined} rel="noreferrer" onClick={(e)=>{
                    if(w.available){e.preventDefault();setWalletConnected(true);setShowWalletModal(false);}
                  }}
                  style={{textDecoration:"none",display:"flex",alignItems:"center",gap:14,padding:"13px 12px",borderRadius:10,cursor:"pointer",marginBottom:4,background:w.available?"#1a2a3a":"transparent",transition:`background 0.2s ${EASE}`,opacity:w.available?1:0.45}}
                  onMouseEnter={e=>{if(!w.available)(e.currentTarget as HTMLElement).style.opacity="0.75";}}
                  onMouseLeave={e=>{if(!w.available)(e.currentTarget as HTMLElement).style.opacity="0.45";}}>
                  <div style={{width:38,height:38,borderRadius:10,background:w.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0}}>{w.initials}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:500,color:C.textPrimary,fontFamily:FS}}>{w.name}</div>
                    <div style={{fontSize:11,color:C.textSecondary,fontFamily:FS,marginTop:2}}>{w.sub}{!w.available && " ↗"}</div>
                  </div>
                  {w.available&&<div style={{width:8,height:8,borderRadius:"50%",background:C.green}} />}
                </a>
              ))}
            </div>
            <div style={{padding:"12px 24px",borderTop:`0.5px solid ${C.border}`}}>
              <div style={{fontSize:11,color:C.textMuted,fontFamily:FS,textAlign:"center"}}>By connecting you agree to Senthos terms of use</div>
            </div>
          </div>
        </div>
      )}

      {showResetConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={()=>setShowResetConfirm(false)}>
          <div style={{background:C.surface,border:`0.5px solid ${C.border}`,borderRadius:20,width:340,padding:"24px 24px 20px"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:15,fontWeight:600,color:C.textPrimary,fontFamily:FD,marginBottom:8}}>Reset demo state?</div>
            <div style={{fontSize:13,color:C.textSecondary,fontFamily:FS,lineHeight:1.5,marginBottom:18}}>All demo positions and vault deposits will be cleared. Your USDC balance returns to $10,000.</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowResetConfirm(false)} style={{flex:1,padding:"10px 0",borderRadius:8,border:`0.5px solid ${C.border}`,background:"transparent",color:C.textSecondary,fontSize:13,fontFamily:FS,cursor:"pointer"}}>Cancel</button>
              <button onClick={handleResetDemo} style={{flex:1,padding:"10px 0",borderRadius:8,border:"none",background:C.teal,color:"#000",fontSize:13,fontFamily:FS,fontWeight:600,cursor:"pointer"}}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </>
    </MobileCtx.Provider>
  );
}
