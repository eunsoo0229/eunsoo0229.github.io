import Icon from '../components/Icon';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { GYM_TRAINING_FILE } from '../lib/gymTraining/library';
import { WEEKDAY_LABEL } from '../lib/dateUtil';
import { getNutritionProfile } from '../lib/nutrition/profileService';
import { generateMealPlan, type GeneratedMealPlan } from '../lib/nutrition/aiMealGen';
import { addMeal } from '../lib/nutrition/mealService';
import type { MealType } from '../lib/nutrition/types';
import {
  dietRequest,
  dietTargets,
  EQUIPMENT_LABEL,
  generateGymPlan,
  GOAL_LABEL,
  LEVEL_LABEL,
  savePlanAsRoutine,
  type Equipment,
  type GymPlan,
  type Level,
  type TrainingGoal,
} from '../lib/gymTrainer/planner';

const MEAL_LABEL: Record<MealType, string> = { breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식' };

/** AI 트레이너 — 목적에 맞는 헬스 루틴 (헬스 루틴으로 저장) + 식단 (오늘 식단에 추가). */
export default function GymTrainerPlanner() {
  const [goal, setGoal] = useState<TrainingGoal>('hypertrophy');
  const [days, setDays] = useState(3);
  const [level, setLevel] = useState<Level>('beginner');
  const [equipment, setEquipment] = useState<Equipment>('gym');
  const [minutes, setMinutes] = useState(60);
  const [cautions, setCautions] = useState('');
  const [plan, setPlan] = useState<GymPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ name: string; active: boolean } | null>(null);
  const [diet, setDiet] = useState<GeneratedMealPlan | null>(null);
  const [dietBusy, setDietBusy] = useState(false);
  const [dietError, setDietError] = useState<string | null>(null);
  const [dietSaved, setDietSaved] = useState(false);
  const profile = useMemo(() => getNutritionProfile(), []);
  const targets = useMemo(() => dietTargets(goal, profile), [goal, profile]);

  async function makePlan() {
    setBusy(true);
    setSaved(null);
    setPlan(await generateGymPlan({ goal, daysPerWeek: days, level, equipment, minutes, cautions }, GYM_TRAINING_FILE.techniques));
    setBusy(false);
  }

  async function save(activate: boolean) {
    if (!plan) return;
    const r = await savePlanAsRoutine(plan, activate);
    setSaved({ name: r.name, active: activate });
  }

  async function makeDiet() {
    setDietBusy(true);
    setDietError(null);
    setDietSaved(false);
    const r = await generateMealPlan({ goalDescription: dietRequest(goal, plan, profile), calorieGoal: targets.calorieGoal, proteinGoalG: targets.proteinGoalG, carbGoalG: targets.carbGoalG, fatGoalG: targets.fatGoalG });
    setDietBusy(false);
    if (r.ok) setDiet(r.data);
    else setDietError(r.message);
  }

  function saveDiet() {
    if (!diet) return;
    for (const mt of Object.keys(MEAL_LABEL) as MealType[]) if (diet[mt]?.length) addMeal({ mealType: mt, foods: diet[mt], source: 'ai_generated', notes: `AI 트레이너 식단 · ${GOAL_LABEL[goal]}` });
    setDietSaved(true);
  }

  const total = diet ? (Object.values(diet).flat() as { calories: number; proteinG: number }[]).reduce((a, f) => ({ kcal: a.kcal + (f.calories || 0), p: a.p + (f.proteinG || 0) }), { kcal: 0, p: 0 }) : null;

  return (
    <div className="page" data-testid="gym-trainer-planner">
      <div className="container">
        <BackButton />
        <div className="section-title">
          <h2><Icon name="dumbbell" /> AI 트레이너 — 루틴·식단 짜기</h2>
        </div>
        <p className="video-status-message" style={{ marginTop: -8 }}>
          목적에 맞춰 MARTIALDEX 헬스 운동으로 일주일 루틴을 짜고, 그 목적에 맞는 하루 식단을 만들어 드립니다. AI가 만든 추정 계획이니 몸 상태에 맞게 조정하세요.
        </p>

        <div className="card info-card">
          <h3>1. 목적과 조건</h3>
          <div className="trainer-form">
            <label className="field-label" htmlFor="tp-goal">목적</label>
            <select id="tp-goal" className="select" value={goal} onChange={(e) => setGoal(e.target.value as TrainingGoal)}>
              {(Object.keys(GOAL_LABEL) as TrainingGoal[]).map((g) => (
                <option key={g} value={g}>{GOAL_LABEL[g]}</option>
              ))}
            </select>
            <label className="field-label" htmlFor="tp-days">주당 횟수</label>
            <select id="tp-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>주 {n}회</option>
              ))}
            </select>
            <label className="field-label" htmlFor="tp-level">수준</label>
            <select id="tp-level" className="select" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
              {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
                <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
              ))}
            </select>
            <label className="field-label" htmlFor="tp-eq">장비</label>
            <select id="tp-eq" className="select" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
              {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((q) => (
                <option key={q} value={q}>{EQUIPMENT_LABEL[q]}</option>
              ))}
            </select>
            <label className="field-label" htmlFor="tp-min">1회 운동 시간</label>
            <select id="tp-min" className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[30, 45, 60, 75, 90].map((m) => (
                <option key={m} value={m}>{m}분</option>
              ))}
            </select>
            <label className="field-label" htmlFor="tp-caution">주의할 부위·통증 (선택)</label>
            <input id="tp-caution" className="select" value={cautions} onChange={(e) => setCautions(e.target.value)} placeholder="예: 오른쪽 어깨가 가끔 아픔, 허리 디스크 이력" />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void makePlan()} disabled={busy} data-testid="trainer-make-plan" style={{ marginTop: 10 }}>
            {busy ? '루틴을 짜는 중…' : '루틴 짜기'}
          </button>
        </div>

        {plan && (
          <div className="card info-card" data-testid="trainer-plan">
            <h3>2. {plan.name}</h3>
            {plan.summary && <p className="video-status-message">{plan.summary}</p>}
            {plan.days.map((d) => (
              <div key={d.weekday} className="trainer-day">
                <strong>
                  {WEEKDAY_LABEL[d.weekday]}요일{d.focus ? ` · ${d.focus}` : ''}
                </strong>
                <ol>
                  {d.exercises.map((e) => (
                    <li key={e.techniqueId}>
                      {e.name} — {e.sets}세트 × {e.seconds ? `${e.seconds}초` : `${e.reps}회`} · 휴식 {e.restSeconds}초{e.note ? <small> · {e.note}</small> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {plan.notes.length > 0 && (
              <ul className="trainer-cues">
                {plan.notes.map((n) => (
                  <li key={n}><Icon name="spark" /> {n}</li>
                ))}
              </ul>
            )}
            <p className="trainer-meta">{plan.source === 'ai' ? 'AI 트레이너가 MARTIALDEX 헬스 운동 목록에서만 골랐습니다.' : '기본 템플릿'} 무게는 첫 운동 때 정해 주세요.</p>
            <div className="chip-row">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void save(true)} data-testid="trainer-save-active">
                헬스 루틴으로 저장 + 이번 주 루틴으로 사용
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void save(false)}>
                저장만
              </button>
            </div>
            {saved && (
              <p className="video-status-message" data-testid="trainer-saved">
                “{saved.name}” 루틴을 저장했습니다{saved.active ? ' · 오늘의 훈련에서 요일별로 불러옵니다' : ''}. <Link to="/training/routines">헬스 루틴 보기</Link>
              </p>
            )}
          </div>
        )}

        <div className="card info-card" data-testid="trainer-diet">
          <h3>3. 목적에 맞는 식단</h3>
          <ul className="trainer-basis">
            {targets.basis.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="video-status-message">
            목표를 바꾸려면 <Link to="/nutrition/goals">영양 목표</Link>에서 설정하세요.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void makeDiet()} disabled={dietBusy} data-testid="trainer-make-diet">
            {dietBusy ? '식단을 짜는 중…' : '식단 짜기'}
          </button>
          {dietError && (
            <div className="ai-error" role="alert">
              {dietError}
            </div>
          )}
          {diet && (
            <div style={{ marginTop: 10 }}>
              {(Object.keys(MEAL_LABEL) as MealType[]).map((mt) =>
                diet[mt]?.length ? (
                  <div key={mt} className="trainer-day">
                    <strong>{MEAL_LABEL[mt]}</strong>
                    <ul>
                      {diet[mt].map((f, i) => (
                        <li key={i}>
                          {f.name} {f.amount} — {Math.round(f.calories)}kcal · 단백질 {Math.round(f.proteinG)}g
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null
              )}
              {total && (
                <p className="video-status-message">
                  합계(추정) 약 {Math.round(total.kcal)}kcal · 단백질 {Math.round(total.p)}g
                </p>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={saveDiet} disabled={dietSaved}>
                {dietSaved ? '오늘 식단에 추가했습니다' : '오늘 식단에 추가'}
              </button>
              {dietSaved && <Link to="/nutrition"> 오늘의 영양 보기</Link>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
