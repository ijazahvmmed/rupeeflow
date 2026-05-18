import { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabase";

const fmt = (n) => "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
const getMonthKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`; };
const getMonthLabel = (k) => { const [y,m] = k.split("-"); return new Date(y,m-1).toLocaleString("en-IN",{month:"long",year:"numeric"}); };

const INCOME_STREAMS = [
  { id:"base",      label:"Base Service Fee",    icon:"💼", color:"#6699FF", note:"Core — protect this" },
  { id:"freelance", label:"Freelance Projects",  icon:"💻", color:"#A8FF3E", note:"Your growth lever" },
  { id:"jersey",    label:"Jersey Profit Share", icon:"👕", color:"#FF6B35", note:"Currently bleeding — log only when profitable" },
];

const EXPENSE_CATS = [
  { id:"food",    label:"Food & Dining",           icon:"🍱", budget:8000 },
  { id:"fuel",    label:"Fuel / Transport",         icon:"⛽", budget:2000 },
  { id:"ent",     label:"Entertainment & Shopping", icon:"🎮", budget:3500 },
  { id:"care",    label:"Personal Care",            icon:"🧴", budget:1500 },
  { id:"subs",    label:"Phone, Internet & Subs",   icon:"📱", budget:7500 },
  { id:"tools",   label:"Tools & Software",         icon:"🔧", budget:2400 },
];

function getTier(income) {
  if (income >= 30000) return { label:"SURPLUS", color:"#A8FF3E", bg:"#1a2e0a", pct:30, rule:"Save 30% — invest aggressively" };
  if (income >= 20000) return { label:"BASE",    color:"#00E5FF", bg:"#0a1e2e", pct:20, rule:"Save 20% — consistent month" };
  return                       { label:"FLOOR",  color:"#FF6B35", bg:"#2e1a0a", pct:10, rule:"Save 10% — protect essentials only" };
}

export default function App() {
  const today = new Date().toISOString().split("T")[0];
  const curMonth = getMonthKey(today);

  // Supabase Configuration Checks
  const isSupabaseConfigured = !!(
    import.meta.env.VITE_SUPABASE_URL && 
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [dataLoading, setDataLoading] = useState(false);

  // Authentication inputs
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");

  const [tab, setTab] = useState("dashboard");
  const [selMonth, setSelMonth] = useState(curMonth);
  const [flash,   setFlash]   = useState(null);

  // Log form
  const [eType,   setEType]   = useState("income");
  const [eStream, setEStream] = useState("base");
  const [eCat,    setECat]    = useState("food");
  const [eAmt,    setEAmt]    = useState("");
  const [eNote,   setENote]   = useState("");
  const [eDate,   setEDate]   = useState(today);

  // Core Data States (Loads from localStorage first as local backup/fallback)
  const [txns, setTxns] = useState(() => {
    try {
      const saved = localStorage.getItem("rf_txns");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const [efSaved, setEfSaved] = useState(() => {
    try {
      const saved = localStorage.getItem("rf_efSaved");
      return saved ? parseFloat(saved) || 0 : 0;
    } catch (e) {
      return 0;
    }
  });

  const [efGoal] = useState(90000);
  
  const [sipAmt, setSipAmt] = useState(() => {
    try {
      const saved = localStorage.getItem("rf_sipAmt");
      return saved ? parseFloat(saved) || 500 : 500;
    } catch (e) {
      return 500;
    }
  });

  // 1. Auth Change Listener
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [isSupabaseConfigured]);

  // 2. Load User Records from Cloud when Authenticated
  useEffect(() => {
    if (!isSupabaseConfigured || !session) return;

    async function loadData() {
      setDataLoading(true);
      try {
        // Fetch transactions
        const { data: txData, error: txError } = await supabase
          .from("transactions")
          .select("*")
          .order("date", { ascending: false });

        if (txError) throw txError;
        if (txData) setTxns(txData);

        // Fetch goals settings
        const { data: setData, error: setError } = await supabase
          .from("user_settings")
          .select("*")
          .single();

        if (setError && setError.code !== "PGRST116") throw setError; // PGRST116 is 'no rows found'
        if (setData) {
          setEfSaved(parseFloat(setData.ef_saved) || 0);
          setSipAmt(parseFloat(setData.sip_amt) || 500);
        }
      } catch (e) {
        console.error("Error loading data from Supabase:", e);
        showFlash("Cloud load failed — running locally", "err");
      } finally {
        setDataLoading(false);
      }
    }

    loadData();
  }, [session, isSupabaseConfigured]);

  // 3. Keep Local Storage updated as offline backup
  useEffect(() => {
    localStorage.setItem("rf_txns", JSON.stringify(txns));
  }, [txns]);

  // 4. Sync Settings Changes (Debounced to avoid high API rate hits while typing)
  useEffect(() => {
    if (!isSupabaseConfigured || !session) {
      localStorage.setItem("rf_efSaved", efSaved.toString());
      localStorage.setItem("rf_sipAmt", sipAmt.toString());
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        await supabase.from("user_settings").upsert({
          user_id: session.user.id,
          ef_saved: efSaved,
          sip_amt: sipAmt,
          updated_at: new Date().toISOString()
        });
      } catch (e) {
        console.error("Supabase settings sync error:", e);
      }
    }, 800);

    return () => clearTimeout(timeout);
  }, [efSaved, sipAmt, session, isSupabaseConfigured]);

  // Compute values
  const monthTxns = useMemo(() => txns.filter(t => getMonthKey(t.date) === selMonth), [txns, selMonth]);
  const allMonths = useMemo(() => {
    const keys = [...new Set(txns.map(t => getMonthKey(t.date)))];
    if (!keys.includes(curMonth)) keys.push(curMonth);
    return keys.sort().reverse();
  }, [txns, curMonth]);

  const incomeMap = useMemo(() => {
    const m = { base:0, freelance:0, jersey:0 };
    monthTxns.filter(t=>t.type==="income").forEach(t => { m[t.stream] = (m[t.stream]||0)+t.amount; });
    return m;
  }, [monthTxns]);

  const totalIncome = incomeMap.base + incomeMap.freelance + incomeMap.jersey;

  const expMap = useMemo(() => {
    const m = {};
    monthTxns.filter(t=>t.type==="expense").forEach(t => { m[t.cat] = (m[t.cat]||0)+t.amount; });
    return m;
  }, [monthTxns]);

  const totalExp = EXPENSE_CATS.reduce((s,c) => s+(expMap[c.id]||0), 0);
  const netLeft  = totalIncome - totalExp;
  const tier     = getTier(totalIncome);
  const recSave  = Math.round(totalIncome * tier.pct / 100);
  const afterSave = netLeft - recSave;

  // Actions
  async function logEntry() {
    const amt = parseFloat(eAmt);
    if (!amt || isNaN(amt)) { showFlash("Enter a valid amount","err"); return; }
    
    const newTx = {
      type: eType,
      stream: eType==="income"?eStream:null,
      cat:    eType==="expense"?eCat:null,
      amount: amt,
      note:   eNote,
      date:   eDate
    };

    if (isSupabaseConfigured && session) {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .insert([{ ...newTx, user_id: session.user.id }])
          .select();
        
        if (error) throw error;
        if (data && data[0]) {
          setTxns(p => [data[0], ...p]);
        }
      } catch (e) {
        console.error("Supabase insert error:", e);
        showFlash("Cloud sync failed. Saving locally.", "err");
        // Fallback local insert
        setTxns(p => [{ ...newTx, id: Date.now() }, ...p]);
      }
    } else {
      setTxns(p => [{ ...newTx, id: Date.now() }, ...p]);
    }

    setEAmt(""); setENote("");
    showFlash(eType==="income"?"💰 Income logged!":"📝 Expense logged!","ok");
  }

  async function deleteTx(id) {
    if (isSupabaseConfigured && session) {
      try {
        const { error } = await supabase
          .from("transactions")
          .delete()
          .eq("id", id);
        
        if (error) throw error;
      } catch (e) {
        console.error("Supabase delete error:", e);
        showFlash("Failed to sync deletion with cloud", "err");
      }
    }
    setTxns(p => p.filter(x => x.id !== id));
  }

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    setAuthLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthSuccess("Account created successfully! Check your email for verification.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showFlash("Welcome back! ⚡", "ok");
      }
    } catch (err) {
      setAuthError(err.message || "An authentication error occurred.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTxns([]);
    setEfSaved(0);
    setSipAmt(500);
    showFlash("Signed out successfully", "ok");
  }

  function showFlash(msg,type) {
    setFlash({msg,type});
    setTimeout(()=>setFlash(null),2200);
  }

  const streamMeta = (id) => INCOME_STREAMS.find(s=>s.id===id);
  const catMeta    = (id) => EXPENSE_CATS.find(c=>c.id===id);

  // RENDER STATES
  if (authLoading) {
    return (
      <div style={S.app}>
        <div style={S.authContainer}>
          <div style={{ color: "#aaa", fontFamily: "monospace", letterSpacing: 2, fontSize: 14 }}>
            VERIFYING CLOUD SESSION...
          </div>
        </div>
      </div>
    );
  }

  // Display Login page if Supabase is active but user is unauthenticated
  if (isSupabaseConfigured && !session) {
    return (
      <div style={S.app}>
        <div style={S.gridBg}/>
        <div style={S.glow1}/><div style={S.glow2}/>
        <div style={S.authContainer}>
          <div style={S.authCard}>
            <div style={S.authTitle}>RUPEE FLOW</div>
            <div style={S.authSub}>Cloud Database Sync</div>

            {authError && <div style={S.authError}>{authError}</div>}
            {authSuccess && <div style={S.authSuccess}>{authSuccess}</div>}

            <form onSubmit={handleAuth}>
              <div style={S.fg}>
                <label style={S.lbl}>Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="name@domain.com"
                  style={S.inp}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div style={S.fg}>
                <label style={S.lbl}>Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  style={S.inp}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button type="submit" style={S.subBtn}>
                {isSignUp ? "CREATE SECURE ACCOUNT" : "SIGN IN TO DASHBOARD"}
              </button>
            </form>

            <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "#444" }}>
              {isSignUp ? "Already have an account?" : "Need a synchronized account?"}{" "}
              <button style={S.authLinkBtn} onClick={() => setIsSignUp(!isSignUp)}>
                {isSignUp ? "Sign In" : "Register"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Finance OS Dashboard Render
  return (
    <div style={S.app}>
      <div style={S.gridBg}/>
      <div style={S.glow1}/><div style={S.glow2}/>

      {/* HEADER */}
      <header style={S.header}>
        <div>
          <div style={S.title}>RUPEE FLOW</div>
          <div style={S.sub}>
            Personal Finance OS · Age 23 &nbsp;
            {isSupabaseConfigured && session ? (
              <span style={{ color: "#A8FF3E", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>
                ● Cloud Synced ({session.user.email})
              </span>
            ) : (
              <span style={{ color: "#aaa", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>
                ● Local Privacy Mode
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {isSupabaseConfigured && session && (
            <button style={S.logoutBtn} onClick={handleSignOut}>SIGN OUT ✕</button>
          )}
          <select style={S.msel} value={selMonth} onChange={e=>setSelMonth(e.target.value)}>
            {allMonths.map(k=><option key={k} value={k}>{getMonthLabel(k)}</option>)}
          </select>
        </div>
      </header>

      {/* PHASE BANNER */}
      <div style={S.phaseBanner}>
        ⚡ CURRENT PHASE: BUILDING &nbsp;·&nbsp; Priority → Buffer ₹90k → Freelance Growth → Jersey Break-even
      </div>

      {/* NAV */}
      <nav style={S.nav}>
        {[["dashboard","📊","Dashboard"],["log","➕","Log"],["jersey","👕","Jersey P&L"],
          ["goals","🎯","Goals"],["history","🕓","History"]].map(([id,ico,lbl])=>(
          <button key={id} style={{...S.navBtn,...(tab===id?S.navActive:{})}} onClick={()=>setTab(id)}>
            <span>{ico}</span><span style={S.navLbl}>{lbl}</span>
          </button>
        ))}
      </nav>

      {flash&&<div style={{...S.flash,background:flash.type==="ok"?"#1a3a1a":"#3a1a1a",borderColor:flash.type==="ok"?"#A8FF3E":"#FF4444"}}>{flash.msg}</div>}

      {dataLoading && (
        <div style={{ position: "fixed", top: 120, left: 0, right: 0, textAlign: "center", zIndex: 10 }}>
          <span style={{ background: "#111", border: "1px solid #222", padding: "6px 12px", borderRadius: 4, fontSize: 10, fontFamily: "monospace", color: "#6699FF" }}>
            SYNCING LATEST ENTRIES...
          </span>
        </div>
      )}

      <main style={S.main}>

        {/* ── DASHBOARD ── */}
        {tab==="dashboard"&&<div style={S.grid}>

          {/* Tier card */}
          <div style={{...S.card,...S.full,background:tier.bg,borderColor:tier.color,borderWidth:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
              <div>
                <div style={{color:tier.color,fontFamily:"monospace",fontSize:10,letterSpacing:3,marginBottom:4}}>INCOME TIER THIS MONTH</div>
                <div style={{color:tier.color,fontFamily:"monospace",fontSize:30,fontWeight:700}}>{tier.label}</div>
                <div style={{color:"#aaa",fontSize:12,marginTop:4}}>{tier.rule}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#555",fontSize:10,letterSpacing:2}}>TOTAL POCKET INCOME</div>
                <div style={{color:"#fff",fontFamily:"monospace",fontSize:28,fontWeight:700}}>{fmt(totalIncome)}</div>
                <div style={{color:tier.color,fontSize:12,marginTop:4}}>Recommended save → {fmt(recSave)}</div>
              </div>
            </div>
          </div>

          {/* 3 income stream cards */}
          {INCOME_STREAMS.map(s=>(
            <div key={s.id} style={{...S.card,borderTop:`3px solid ${s.color}`}}>
              <div style={{color:"#555",fontSize:10,letterSpacing:2,marginBottom:6}}>{s.icon} {s.label.toUpperCase()}</div>
              <div style={{color:s.color,fontFamily:"monospace",fontSize:22,fontWeight:700}}>{fmt(incomeMap[s.id])}</div>
              <div style={{color:"#444",fontSize:10,marginTop:4}}>{s.note}</div>
              {s.id==="jersey"&&<div style={{color:"#FF4444",fontSize:10,marginTop:4}}>📌 Log only when business turns profit</div>}
            </div>
          ))}

          {/* Expense breakdown */}
          <div style={{...S.card,...S.span2}}>
            <div style={S.cardTitle}>💸 Personal Expenses This Month</div>
            <div style={{marginTop:12}}>
              {EXPENSE_CATS.map(c=>{
                const val = expMap[c.id]||0;
                const pct = c.budget>0 ? Math.min((val/c.budget)*100,100) : 0;
                const over = val > c.budget;
                return (
                  <div key={c.id} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <span style={{color:"#aaa",fontSize:12}}>{c.icon} {c.label}</span>
                      <span style={{color:over?"#FF4444":"#fff",fontFamily:"monospace",fontSize:12}}>
                        {fmt(val)} <span style={{color:"#444",fontSize:10}}>/ {fmt(c.budget)}</span>
                      </span>
                    </div>
                    <div style={S.progBg}>
                      <div style={{...S.progFill,width:`${pct}%`,background:over?"#FF4444":"#FF6B35"}}/>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{...S.divider,marginTop:14}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{color:"#555",fontSize:11}}>TOTAL EXPENSES</span>
              <span style={{color:"#FF6B35",fontFamily:"monospace",fontSize:16,fontWeight:700}}>{fmt(totalExp)}</span>
            </div>
          </div>

          {/* Net card */}
          <div style={S.card}>
            <div style={S.cardTitle}>🧮 Net Summary</div>
            <div style={{marginTop:14}}>
              {[
                ["Total Income",   fmt(totalIncome), "#6699FF"],
                ["Total Expenses", fmt(totalExp),    "#FF6B35"],
                ["Net Remaining",  (netLeft>=0?"+ ":"-")+fmt(netLeft),  netLeft>=0?"#A8FF3E":"#FF4444"],
                ["Recommended Save", fmt(recSave),  "#00E5FF"],
                ["After Saving",   (afterSave>=0?"+ ":"-")+fmt(afterSave), afterSave>=0?"#fff":"#FF4444"],
              ].map(([lbl,val,clr])=>(
                <div key={lbl} style={{display:"flex",justifyContent:"space-between",marginBottom:10,paddingBottom:10,borderBottom:"1px solid #111"}}>
                  <span style={{color:"#666",fontSize:11}}>{lbl}</span>
                  <span style={{color:clr,fontFamily:"monospace",fontSize:13,fontWeight:700}}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Jersey status */}
          <div style={{...S.card,...S.full,background:"#0d0500",borderColor:"#FF6B3544"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>👕</span>
              <div>
                <div style={{color:"#FF6B35",fontFamily:"monospace",fontSize:11,letterSpacing:2}}>JERSEY BUSINESS STATUS</div>
                <div style={{color:"#FF4444",fontSize:12,marginTop:3}}>Currently bleeding — ads running from separate business account (not your personal money)</div>
                <div style={{color:"#555",fontSize:11,marginTop:3}}>Once profitable → profit share will appear above. Track full P&L in Jersey tab.</div>
              </div>
            </div>
          </div>

        </div>}

      {/* ── LOG ── */}
      {tab==="log"&&<div style={{maxWidth:500,margin:"0 auto"}}>
        <div style={S.card}>
          <div style={S.cardTitle}>Log a Transaction</div>
          <div style={{...S.toggleRow,marginTop:16}}>
            <button style={{...S.tBtn,...(eType==="income"?{background:"#A8FF3E22",borderColor:"#A8FF3E",color:"#A8FF3E"}:{})}} onClick={()=>setEType("income")}>💰 Income</button>
            <button style={{...S.tBtn,...(eType==="expense"?{background:"#FF6B3522",borderColor:"#FF6B35",color:"#FF6B35"}:{})}} onClick={()=>setEType("expense")}>💸 Expense</button>
          </div>

          <div style={S.fg}>
            <label style={S.lbl}>Date</label>
            <input type="date" style={S.inp} value={eDate} onChange={e=>setEDate(e.target.value)}/>
          </div>
          <div style={S.fg}>
            <label style={S.lbl}>Amount (₹)</label>
            <input type="number" placeholder="Enter amount" style={S.inp} value={eAmt} onChange={e=>setEAmt(e.target.value)}/>
          </div>

          {eType==="income"&&(
            <div style={S.fg}>
              <label style={S.lbl}>Income Stream</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {INCOME_STREAMS.map(s=>(
                  <button key={s.id} style={{...S.sBtn,...(eStream===s.id?{borderColor:s.color,color:s.color,background:s.color+"15"}:{})}} onClick={()=>setEStream(s.id)}>
                    <div style={{fontSize:18}}>{s.icon}</div>
                    <div style={{fontSize:9,marginTop:3,lineHeight:1.3}}>{s.label}</div>
                  </button>
                ))}
              </div>
              {eStream==="jersey"&&<div style={{color:"#FF6B35",fontSize:10,marginTop:6}}>⚠️ Only log jersey income when the business actually pays you profit</div>}
            </div>
          )}

          {eType==="expense"&&(
            <div style={S.fg}>
              <label style={S.lbl}>Category</label>
              <select style={S.inp} value={eCat} onChange={e=>setECat(e.target.value)}>
                {EXPENSE_CATS.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label} (budget: {fmt(c.budget)})</option>)}
              </select>
              <div style={{color:"#444",fontSize:10,marginTop:4}}>📌 Jersey business expenses = tracked in Jersey P&L tab (not here)</div>
            </div>
          )}

          <div style={S.fg}>
            <label style={S.lbl}>Note (optional)</label>
            <input type="text" placeholder="Client name, description..." style={S.inp} value={eNote} onChange={e=>setENote(e.target.value)}/>
          </div>
          <button style={S.subBtn} onClick={logEntry}>{eType==="income"?"✅ Log Income":"✅ Log Expense"}</button>
        </div>

        {monthTxns.length>0&&(
          <div style={{...S.card,marginTop:16}}>
            <div style={S.cardTitle}>Recent — {getMonthLabel(selMonth)}</div>
            {monthTxns.slice(0,6).map(t=>(
              <div key={t.id} style={S.txRow}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontSize:18}}>{t.type==="income"?streamMeta(t.stream)?.icon:catMeta(t.cat)?.icon}</span>
                  <div>
                    <div style={{color:"#ddd",fontSize:13}}>{t.type==="income"?streamMeta(t.stream)?.label:catMeta(t.cat)?.label}</div>
                    {t.note&&<div style={{color:"#555",fontSize:11}}>{t.note}</div>}
                    <div style={{color:"#333",fontSize:10}}>{t.date}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{color:t.type==="income"?"#A8FF3E":"#FF6B35",fontFamily:"monospace",fontSize:13,fontWeight:700}}>
                    {t.type==="income"?"+":"-"}{fmt(t.amount)}
                  </span>
                  <button style={S.delBtn} onClick={()=>deleteTx(t.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* ── JERSEY P&L ── */}
      {tab==="jersey"&&<div style={{maxWidth:560,margin:"0 auto"}}>
        <div style={{...S.card,borderColor:"#FF6B3544",background:"#0d0500"}}>
          <div style={{color:"#FF6B35",fontFamily:"monospace",fontSize:12,letterSpacing:2,marginBottom:4}}>👕 JERSEY BUSINESS P&L</div>
          <div style={{color:"#FF4444",fontSize:11,marginBottom:16}}>⚠️ Separate from your personal finances. Ads funded from business account.</div>

          {[
            {label:"Revenue (Total Business)", items:[
              {id:"rev_reg",lbl:"Regular Jersey Sales",val:20000},
              {id:"rev_cust",lbl:"Custom / Bulk Orders",val:5000},
            ]},
            {label:"Expenses (From Business Account)", items:[
              {id:"exp_stock",lbl:"Stock & Inventory",val:12000},
              {id:"exp_print",lbl:"Printing & Packaging",val:4000},
              {id:"exp_ship",lbl:"Shipping",val:3500},
              {id:"exp_ads",lbl:"Ads & Marketing",val:20000,note:"NOT your personal money"},
              {id:"exp_misc",lbl:"Other Operating",val:1000},
            ]},
          ].map(section=>(
            <div key={section.label} style={{marginBottom:20}}>
              <div style={{color:"#555",fontSize:10,letterSpacing:2,marginBottom:10}}>{section.label.toUpperCase()}</div>
              {section.items.map(item=>(
                <div key={item.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #111"}}>
                  <div>
                    <span style={{color:"#aaa",fontSize:12}}>{item.lbl}</span>
                    {item.note&&<div style={{color:"#FF4444",fontSize:9}}>{item.note}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{color:section.label.includes("Revenue")?"#A8FF3E":"#FF6B35",fontFamily:"monospace",fontSize:12}}>{fmt(item.val)}</div>
                    <div style={{color:"#444",fontSize:9}}>Your 50%: {fmt(item.val*0.5)}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {(()=> {
            const rev=25000, exp=40500;
            const profit=rev-exp;
            return (
              <div style={{background:"#0a0a0a",borderRadius:8,padding:14,marginTop:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{color:"#666",fontSize:11}}>Business Net P&L</span>
                  <span style={{color:profit>=0?"#A8FF3E":"#FF4444",fontFamily:"monospace",fontSize:14,fontWeight:700}}>{profit>=0?"+":""}{fmt(profit)}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{color:"#666",fontSize:11}}>Your 50% Share</span>
                  <span style={{color:profit>=0?"#A8FF3E":"#FF4444",fontFamily:"monospace",fontSize:14,fontWeight:700}}>{profit>=0?"+":""}{fmt(profit*0.5)}</span>
                </div>
                <div style={{color:"#444",fontSize:10,marginTop:10}}>
                  {profit<0?"⏳ Still bleeding. Keep going. Log your share in income only once positive.":"✅ Profitable! Log your share in income tab."}
                </div>
              </div>
            );
          })()}
        </div>
      </div>}

      {/* ── GOALS ── */}
      {tab==="goals"&&<div style={S.grid}>

        {/* Priority stack */}
        <div style={{...S.card,...S.full}}>
          <div style={S.cardTitle}>⚡ Your Priority Order — Do In Sequence</div>
          <div style={{marginTop:14}}>
            {[
              ["1","Build ₹90,000 Buffer","Before ANYTHING else — 3 bad months covered","#FF4444"],
              ["2","Protect ₹15k Base Fee","Deliver excellence. Never lose this client.","#FF6B35"],
              ["3","Grow Freelance Income","Each new client = ₹5k–15k more/month. This is your lever.","#A8FF3E"],
              ["4","Jersey Break-even","Let ads work. Don't pressure it for personal income yet.","#00E5FF"],
              ["5","Start ₹500/mo SIP","Habit > amount. Increase ₹500 per new client.","#9C27B0"],
              ["6","Scale Jersey Hard","Once profitable + buffer exists. Then go all in.","#FFC107"],
            ].map(([num,title,detail,clr])=>(
              <div key={num} style={{display:"flex",gap:14,padding:"12px 0",borderBottom:"1px solid #111",alignItems:"flex-start"}}>
                <div style={{color:clr,fontFamily:"monospace",fontSize:18,fontWeight:700,minWidth:24}}>{num}</div>
                <div>
                  <div style={{color:"#fff",fontSize:13,fontWeight:600}}>{title}</div>
                  <div style={{color:"#555",fontSize:11,marginTop:3}}>{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Emergency fund */}
        <div style={{...S.card,...S.span2}}>
          <div style={S.cardTitle}>🛡️ Emergency Fund — Target ₹90,000</div>
          <div style={{color:"#555",fontSize:11,marginBottom:16,marginTop:6}}>3 months of worst-case survival. Non-negotiable before scaling anything.</div>
          <div style={S.fg}>
            <label style={S.lbl}>Amount Saved So Far (₹)</label>
            <input type="number" style={S.inp} value={efSaved} onChange={e=>setEfSaved(parseFloat(e.target.value)||0)}/>
          </div>
          <div style={S.progBg}>
            <div style={{...S.progFill,width:`${Math.min((efSaved/efGoal)*100,100)}%`,background:"#00E5FF",height:12,borderRadius:6}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
            <span style={{color:"#00E5FF",fontFamily:"monospace",fontSize:12}}>{fmt(efSaved)} saved</span>
            <span style={{color:"#555",fontSize:12}}>{fmt(efGoal-efSaved)} to go · {((efSaved/efGoal)*100).toFixed(1)}%</span>
          </div>
          {totalIncome>0&&recSave>0&&(
            <div style={{background:"#001a2e",border:"1px solid #00E5FF33",borderRadius:8,padding:12,marginTop:12,color:"#00E5FF",fontSize:11}}>
              💡 At current savings rate of {fmt(recSave)}/mo → reach ₹90k in ~{Math.ceil((efGoal-efSaved)/recSave)} months
            </div>
          )}
        </div>

        {/* SIP */}
        <div style={S.card}>
          <div style={S.cardTitle}>📈 SIP Goal</div>
          <div style={{color:"#555",fontSize:11,marginBottom:16,marginTop:6}}>Start small. Build the habit. Increase with every new client.</div>
          <div style={S.fg}>
            <label style={S.lbl}>Monthly SIP (₹)</label>
            <input type="number" style={S.inp} value={sipAmt} onChange={e=>setSipAmt(parseFloat(e.target.value)||0)}/>
          </div>
          {[
            ["Annual invested",   sipAmt*12],
            ["5yr @ 12%",        sipAmt*((Math.pow(1.01,60)-1)/0.01)],
            ["10yr @ 12%",       sipAmt*((Math.pow(1.01,120)-1)/0.01)],
          ].map(([lbl,val])=>(
            <div key={lbl} style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{color:"#555",fontSize:11}}>{lbl}</span>
              <span style={{color:"#9C27B0",fontFamily:"monospace",fontSize:12,fontWeight:700}}>{fmt(val)}</span>
            </div>
          ))}
          <div style={{color:"#333",fontSize:10,marginTop:8}}>Even ₹500/mo for 10 years builds a meaningful corpus. Start now.</div>
        </div>

        {/* Waterfall */}
        <div style={{...S.card,...S.full}}>
          <div style={S.cardTitle}>💧 Savings Waterfall</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:14}}>
            {[
              ["消耗 FLOOR\n< ₹20k",    "#FF6B35","Essentials only\nSave ₹1,500 min\nNo SIP\nSurvive clean"],
              ["基础 BASE\n₹20k–₹30k",  "#00E5FF","Save 20%\nNormal budget\n₹500 SIP\nStay consistent"],
              ["结余 SURPLUS\n₹30k+",   "#A8FF3E","Save 30%\nIncrease SIP\nNormal lifestyle\nGo guilt-free"],
              ["腾飞 BEYOND\n₹35k+",    "#FFC107","50% extra → buffer\nOnce ₹90k hit:\n50% invest\n50% yours"],
            ].map(([tier,clr,rules])=>(
              <div key={tier} style={{background:"#0d0d0d",borderTop:`3px solid ${clr}`,borderRadius:8,padding:12}}>
                <div style={{color:clr,fontFamily:"monospace",fontSize:10,marginBottom:10,whiteSpace:"pre-line",fontWeight:700}}>{tier}</div>
                {rules.split("\n").map((r,i)=><div key={i} style={{color:"#aaa",fontSize:11,marginBottom:4,paddingLeft:8,borderLeft:`2px solid ${clr}44`}}>{r}</div>)}
              </div>
            ))}
          </div>
        </div>

      </div>}

      {/* ── HISTORY ── */}
      {tab==="history"&&<div style={{maxWidth:600,margin:"0 auto"}}>
        <div style={S.card}>
          <div style={S.cardTitle}>🕓 {getMonthLabel(selMonth)} — All Transactions</div>
          {monthTxns.length===0
            ? <div style={{color:"#333",textAlign:"center",padding:40,fontSize:14}}>No transactions logged yet.</div>
            : <>
              {monthTxns.map(t=>(
                <div key={t.id} style={S.txRow}>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    <span style={{fontSize:20}}>{t.type==="income"?streamMeta(t.stream)?.icon:catMeta(t.cat)?.icon}</span>
                    <div>
                      <div style={{color:"#ddd",fontSize:13}}>{t.type==="income"?streamMeta(t.stream)?.label:catMeta(t.cat)?.label}</div>
                      {t.note&&<div style={{color:"#555",fontSize:11}}>{t.note}</div>}
                      <div style={{color:"#333",fontSize:10}}>{t.date}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{color:t.type==="income"?"#A8FF3E":"#FF6B35",fontFamily:"monospace",fontSize:13,fontWeight:700}}>
                      {t.type==="income"?"+":"-"}{fmt(t.amount)}
                    </span>
                    <button style={S.delBtn} onClick={()=>deleteTx(t.id)}>✕</button>
                  </div>
                </div>
              ))}
              <div style={S.divider}/>
              {[["Income",totalIncome,"#A8FF3E"],["Expenses",totalExp,"#FF6B35"],["Net",netLeft,netLeft>=0?"#A8FF3E":"#FF4444"]].map(([l,v,c])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{color:"#555",fontSize:12}}>{l}</span>
                  <span style={{color:c,fontFamily:"monospace",fontSize:14,fontWeight:700}}>{l==="Net"&&v>=0?"+":""}{fmt(v)}</span>
                </div>
              ))}
            </>
          }
        </div>
      </div>}

    </main>
  </div>
  );
}

const S = {
  app:     { minHeight:"100vh", background:"#080808", color:"#fff", fontFamily:"'DM Sans','Segoe UI',sans-serif", position:"relative", overflow:"hidden" },
  gridBg:  { position:"fixed", inset:0, zIndex:0, backgroundImage:"linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)", backgroundSize:"40px 40px", pointerEvents:"none" },
  glow1:   { position:"fixed", top:-200, left:-200, width:600, height:600, background:"radial-gradient(circle,rgba(0,229,255,0.04) 0%,transparent 70%)", zIndex:0, pointerEvents:"none" },
  glow2:   { position:"fixed", bottom:-200, right:-200, width:600, height:600, background:"radial-gradient(circle,rgba(168,255,62,0.04) 0%,transparent 70%)", zIndex:0, pointerEvents:"none" },
  header:  { position:"relative", zIndex:10, display:"flex", justifyContent:"space-between", alignItems:"center", padding:"20px 24px 0" },
  title:   { fontFamily:"monospace", fontSize:20, fontWeight:700, letterSpacing:4, color:"#fff" },
  sub:     { color:"#444", fontSize:11, letterSpacing:2, marginTop:2 },
  msel:    { background:"#111", border:"1px solid #222", color:"#aaa", padding:"6px 12px", borderRadius:6, fontSize:12, fontFamily:"monospace", cursor:"pointer" },
  phaseBanner: { position:"relative", zIndex:10, background:"#1A1400", borderBottom:"1px solid #332800", color:"#FFC107", fontSize:10, letterSpacing:1, textAlign:"center", padding:"8px 24px", marginTop:12 },
  nav:     { position:"relative", zIndex:10, display:"flex", gap:4, padding:"16px 24px 0", borderBottom:"1px solid #1a1a1a", overflowX:"auto" },
  navBtn:  { background:"transparent", border:"none", color:"#444", padding:"8px 14px", cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", gap:6, borderBottom:"2px solid transparent", marginBottom:-1, whiteSpace:"nowrap", transition:"all 0.15s" },
  navActive:{ color:"#fff", borderBottomColor:"#fff" },
  navLbl:  {},
  flash:   { position:"fixed", top:80, right:24, zIndex:100, padding:"10px 20px", borderRadius:8, border:"1px solid", fontSize:13, fontWeight:600 },
  main:    { position:"relative", zIndex:10, padding:"20px 24px 60px" },
  grid:    { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, zIndex: 10, position: "relative" },
  full:    { gridColumn:"1 / -1" },
  span2:   { gridColumn:"span 2" },
  card:    { background:"#0d0d0d", border:"1px solid #1a1a1a", borderRadius:12, padding:20, zIndex: 10, position: "relative" },
  cardTitle:{ color:"#555", fontSize:10, letterSpacing:2, textTransform:"uppercase" },
  divider: { height:1, background:"#1a1a1a", margin:"12px 0" },
  progBg:  { background:"#1a1a1a", borderRadius:4, height:6, overflow:"hidden" },
  progFill:{ height:"100%", borderRadius:4, transition:"width 0.6s ease" },
  fg:      { marginBottom:16 },
  lbl:     { color:"#555", fontSize:10, letterSpacing:1, display:"block", marginBottom:6 },
  inp:     { width:"100%", background:"#111", border:"1px solid #222", color:"#fff", padding:"10px 14px", borderRadius:8, fontSize:14, fontFamily:"inherit", boxSizing:"border-box", outline:"none" },
  toggleRow:{ display:"flex", gap:8, marginBottom:16 },
  tBtn:    { flex:1, background:"#111", border:"1px solid #222", color:"#555", padding:"10px", borderRadius:8, cursor:"pointer", fontSize:13, fontFamily:"inherit", transition:"all 0.15s" },
  sBtn:    { background:"#111", border:"1px solid #222", color:"#555", padding:"12px 8px", borderRadius:8, cursor:"pointer", textAlign:"center", transition:"all 0.15s" },
  subBtn:  { width:"100%", background:"#fff", color:"#000", border:"none", padding:"13px", borderRadius:8, fontFamily:"monospace", fontSize:13, fontWeight:700, cursor:"pointer", marginTop:4, letterSpacing:1 },
  txRow:   { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #111" },
  delBtn:  { background:"transparent", border:"none", color:"#333", cursor:"pointer", fontSize:12, padding:"4px 6px" },

  // Auth Styles
  authContainer: { display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", position: "relative", zIndex: 10, padding: 20 },
  authCard: { background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, boxShadow: "0 20px 40px rgba(0,0,0,0.5)", zIndex: 20, position: "relative" },
  authTitle: { fontSize: 22, fontWeight: 700, fontFamily: "monospace", letterSpacing: 4, textAlign: "center", marginBottom: 6, color: "#fff" },
  authSub: { fontSize: 9, color: "#555", textAlign: "center", marginBottom: 24, letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace" },
  authError: { background: "#3a1a1a", border: "1px solid #FF4444", color: "#FF4444", padding: "10px 14px", borderRadius: 8, fontSize: 12, marginBottom: 16, lineHeight: 1.4 },
  authSuccess: { background: "#1a3a1a", border: "1px solid #A8FF3E", color: "#A8FF3E", padding: "10px 14px", borderRadius: 8, fontSize: 12, marginBottom: 16, lineHeight: 1.4 },
  authLinkBtn: { background: "none", border: "none", color: "#00E5FF", textDecoration: "underline", cursor: "pointer", fontSize: 12, display: "inline", padding: 0 },
  logoutBtn: { background: "transparent", border: "1px solid #333", color: "#666", padding: "6px 12px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", cursor: "pointer", transition: "all 0.15s", letterSpacing: 1 },
};
