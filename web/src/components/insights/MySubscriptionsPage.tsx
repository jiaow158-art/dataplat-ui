// P0-T6 改版 ck 亮色体系：仅换壳（AppShell/PageHeader/SectionCard/按钮/空态），
// API 调用、state、handlers 与改版前逐字一致（kind/value/busy/load/add 全未动）。
import { useEffect, useState } from "react";
import { apiInsightAddSubscription, apiInsightNotifications, apiInsightReadAllNotifications, apiInsightRemoveSubscription, apiInsightSubscriptions } from "../../api";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import StatusTag from "../cockpit/StatusTag";
import EmptyState from "../cockpit/EmptyState";
import PrimaryButton from "../cockpit/PrimaryButton";
import { filterControlClass } from "../cockpit/FilterBar";

export default function MySubscriptionsPage() {
  const [subs,setSubs]=useState<Array<any>>([]); const [notes,setNotes]=useState<Array<any>>([]); const [kind,setKind]=useState("region"); const [value,setValue]=useState(""); const [busy,setBusy]=useState(false);
  const load=async()=>{const [s,n]=await Promise.all([apiInsightSubscriptions(),apiInsightNotifications()]);setSubs(s.items);setNotes(n.items)};
  useEffect(()=>{void load()},[]);
  const add=async()=>{if(!value.trim()||busy)return;setBusy(true);try{await apiInsightAddSubscription({kind,value:value.trim(),label:value.trim()});setValue("");await load()}finally{setBusy(false)}};
  return (
    <AppShell>
      <PageHeader title="我的关注" subtitle="只看与你有关的经营信号 · 关注条件不改变事件判定" />
      <div className="grid gap-5 lg:grid-cols-[.9fr_1.5fr]">
        <SectionCard title="关注对象">
          <div className="rounded-xl border border-dashed border-ck-line-strong bg-ck-card-soft p-4">
            <select className={`w-full text-sm ${filterControlClass}`} value={kind} onChange={e=>setKind(e.target.value)}>
              <option value="region">区域 / 组织</option>
              <option value="event">具体事件</option>
              <option value="domain">业务域</option>
              <option value="metric">指标</option>
            </select>
            <input className={`mt-2 w-full text-sm ${filterControlClass}`} value={value} onChange={e=>setValue(e.target.value)} placeholder="例如：华南运营中心" />
            <PrimaryButton className="mt-3 w-full" onClick={()=>void add()} disabled={busy}>＋ 添加到我的关注</PrimaryButton>
          </div>
          <div className="mt-4 divide-y divide-ck-line">
            {subs.length===0 && <EmptyState text="暂无关注对象" hint="在上方添加区域 / 事件 / 业务域 / 指标后在此管理" />}
            {subs.map(s=>(
              <div className="flex items-center justify-between py-3" key={s.id}>
                <div>
                  <b className="text-sm text-ck-ink">{s.label}</b>
                  <p className="text-xs text-ck-ink-3">{s.kind}</p>
                </div>
                <button className="text-xs text-ck-danger hover:underline" onClick={async()=>{await apiInsightRemoveSubscription(s.id);await load()}}>取消关注</button>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard
          title="关注动态"
          extra={<button className="text-ck-primary hover:underline" onClick={async()=>{await apiInsightReadAllNotifications();await load()}}>全部标为已读 →</button>}
        >
          <p className="text-xs text-ck-ink-3">新发生、升级或解除的事件</p>
          <div className="mt-3 grid gap-3">
            {notes.length===0 && <EmptyState text="暂无关注动态" hint="关注的对象有新事件、升级或解除时会在这里提醒" />}
            {notes.map(n=>(
              <article className="rounded-lg border border-ck-line bg-ck-card-soft p-4" key={n.id}>
                <div className="flex justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-ck-ink">{n.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-ck-ink-2">{n.summary}</p>
                    <span className="mt-2 inline-block"><StatusTag tone="info" size="sm">{n.kind}</StatusTag></span>
                  </div>
                  <time className="text-[11px] text-ck-ink-3">{String(n.created_at).slice(0,16)}</time>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
