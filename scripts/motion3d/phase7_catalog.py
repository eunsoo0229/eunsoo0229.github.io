"""Phase 7: write the 11 rebuilt / new clips into data/curated/motion3d.json (and retire RNC v2), from the authoring
logs (assets/3d/motion-library/<art>/<id>.json) and the mesh reviews (data/audit/motion3d-<id>-duo-review.json).

    python3 scripts/motion3d/phase7_catalog.py

Idempotent: an entry with the same clipId is replaced. Every number written (duration, frames, phases, hashes, review
maxima in knownIssues) is read from the files themselves, not typed in.
"""
import hashlib
import json
import os

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CAT = os.path.join(APP, "data/curated/motion3d.json")
TODAY = "2026-11-25"

# id -> (art dir, technique module, variant label, extra catalog fields)
CLIPS = [
    ("bjj-rear-naked-choke-m2m-v3", "bjj", "bjj_rear_naked_choke_v3", "2인 시연", {"cameraElevationDeg": 12}),
    ("boxing-rear-uppercut-m2m-v1", "boxing", "boxing_rear_uppercut", "오소독스", {"stance": "orthodox", "leadHand": "left", "rearHand": "right"}),
    ("boxing-slip-m2m-v1", "boxing", "boxing_slip", "오소독스", {"stance": "orthodox", "leadHand": "left", "rearHand": "right"}),
    ("kickboxing-body-kick-m2m-v1", "kickboxing", "kickboxing_body_kick", "오소독스", {"stance": "orthodox", "leadHand": "left", "rearHand": "right"}),
    ("kickboxing-straight-knee-m2m-v1", "kickboxing", "kickboxing_straight_knee", "오소독스", {"stance": "orthodox", "leadHand": "left", "rearHand": "right"}),
    ("kickboxing-horizontal-elbow-m2m-v1", "kickboxing", "kickboxing_horizontal_elbow", "오소독스", {"stance": "orthodox", "leadHand": "left", "rearHand": "right"}),
    ("muaythai-push-teep-m2m-v1", "muay-thai", "muaythai_push_teep", "오소독스", {"stance": "orthodox", "leadHand": "left", "rearHand": "right"}),
    ("mma-overhand-m2m-v1", "mma", "mma_overhand", "오소독스", {"stance": "orthodox", "leadHand": "left", "rearHand": "right"}),
    ("wrestling-sprawl-m2m-v1", "wrestling", "wrestling_sprawl", "1인 시연", {"cameraElevationDeg": 20}),
    ("bjj-hip-escape-m2m-v1", "bjj", "bjj_hip_escape", "1인 시연", {"cameraElevationDeg": 40}),
    ("bjj-technical-stand-up-m2m-v1", "bjj", "bjj_technical_stand_up", "1인 시연", {"cameraElevationDeg": 14}),
]
SEAM_NOTE = "캐릭터가 분절형 마네킹이라 관절 링(어깨·팔꿈치·무릎 이음매)은 레스트에서도 겹침 — 자기 몸 교차 검사는 인접하지 않은 부위끼리만 셈"
HUMAN_NOTE = "사람(코치·사용자)의 시각적 검수 전 — 자동 검사(관통·바닥·발 미끄러짐·순간이동·안전 간격)와 렌더 확인만 됨"


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def review_stats(rv):
    keys = rv["keys"]
    actors = sorted({w for k in keys for w in k["lowestSkin"]})
    slides = [v for k in keys[1:] for v in k.get("plantedSlideM", {}).values()]
    return {
        "lowestSkinM": round(min(min(k["lowestSkin"].values()) for k in keys), 4),
        "plantedSlideMaxM": round(max(slides) if slides else 0.0, 4),
        "plantedSlideTotalM": round(sum(slides), 3),
        "pelvisStepMaxM": round(max(max(k["pelvisStepM"].values()) for k in keys), 4),
        "selfContactMax": {w: max(sum(k.get("selfContact", {}).get(w, {}).values()) for k in keys) for w in actors},
        "bodyPenetrationMax": max(k.get("bodyPenetration", 0) for k in keys),
        "gripContactMax": max(k.get("gripContact", 0) for k in keys),
    }


def entry(clip_id, art, module, variant, extra):
    log = json.load(open(os.path.join(APP, f"assets/3d/motion-library/{art}/{clip_id}.json")))
    meta = log["meta"]
    rv_path = f"data/audit/motion3d-{clip_id}-duo-review.json"
    st = review_stats(json.load(open(os.path.join(APP, rv_path))))
    glb = os.path.join(APP, f"public/motion3d/anims/{clip_id}.glb")
    fps, last = meta["fps"], meta["lastKey"]
    duo = len(meta["placement"]) > 1
    actors = (
        [
            {"id": "A", "role": "performer", "label": "흰색 · 시연자 (기술을 거는 사람)", "rig": "m2m-human-v1", "character": "m2m-human-base-v1", "nodePrefix": "A_", "color": "#dcd8d0"},
            {"id": "B", "role": "partner", "label": "빨간색 · 상대 (기술을 받는 사람)", "rig": "m2m-human-v1", "character": "m2m-human-base-v1", "nodePrefix": "B_", "color": "#9e2a24"},
        ]
        if duo
        else [{"id": "A", "role": "performer", "label": "시연자", "rig": "m2m-human-v1", "character": "m2m-human-base-v1", "nodePrefix": None}]
    )
    issues = [SEAM_NOTE, HUMAN_NOTE]
    if st["lowestSkinM"] < -0.001:
        issues.append(f"피부가 바닥 아래로 최대 {abs(st['lowestSkinM']) * 1000:.0f} mm 내려가는 순간 있음")
    if st["plantedSlideMaxM"] > 0.005:
        issues.append(f"발이 딛거나 떼는 순간 발볼 이동 키당 최대 {st['plantedSlideMaxM'] * 100:.1f} cm (클립 전체 {st['plantedSlideTotalM'] * 100:.1f} cm)")
    if max(st["selfContactMax"].values()) > 0:
        issues.append("자기 몸 부위 접촉(인접하지 않은 부위) 최대 " + ", ".join(f"{w} {v}" for w, v in st["selfContactMax"].items()) + " 삼각형 쌍 — 대부분 전환 중 손·팔이 스치는 순간 (data/audit 검수 JSON 키별 기록)")
    if duo:
        issues.append(f"2인 밀착(가슴-등, 훅, 머리 옆) 부위 겹침 최대 {st['bodyPenetrationMax']} 삼각형 쌍, 손 접촉 최대 {st['gripContactMax']} — 분절형 마네킹 한계")
    e = {
        "clipId": clip_id,
        "variant": variant,
        "techniqueIds": meta["techniqueIds"],
        "title": meta["title"],
        "actors": actors,
        "file": f"motion3d/anims/{clip_id}.glb",
        "embedsCharacter": False,
        "animation": clip_id,
        "fps": fps,
        "durationSec": round(last / fps, 4),
        "frameCount": last,
        "phases": [{"name": n, "label": label, "startSec": round(a / fps, 4), "endSec": round(b / fps, 4)} for n, label, a, b in meta["phases"]],
        "phaseKeys": {n: [a, b] for n, _, a, b in meta["phases"]},
        **({"contactKey": meta["contactKey"]} if "contactKey" in meta else {}),
        **({"side": meta["side"]} if "side" in meta else {}),
        "cameraFront": "rest",
        "phaseMethod": "제작 시 정의한 키 구간 — 측정이 아니라 설계값",
        **extra,
        "version": "1.0.0" if not clip_id.endswith("-v3") else "3.0.0",
        "source": {
            "motion": "MARTIALDEX 자체 제작 (Phase 7): Blender 3.4에서 키 포즈 + 이징을 매 키 풀어(2-본 IK, 고정된 발·들린 다리, 가슴 기준 가드 손, 시선) 회전 키프레임으로 기록. 모션 캡처·외부 애니메이션 미사용, 공개된 기본 코칭 원리만 참고.",
            "authoringScript": f"scripts/motion3d/techniques/{module}.py + scripts/motion3d/author_duo.py (grapple_kit.py, rig_kit.py{', solo_kit.py' if not duo else ''})",
            "blendSource": f"assets/3d/motion-library/{art}/{clip_id}.blend",
            "glbSha256": sha(glb),
            "review": f"{rv_path} (scripts/motion3d/duo_review.py)",
            "reviewImage": f"data/audit/motion3d-phase7/{clip_id}.png",
            "reviewStats": st,
        },
        "license": {"motion": "MARTIALDEX 자체 제작 (외부 라이선스 없음)", "character": "CC0-1.0 (Mesh2Motion / Quaternius)", "note": "동작·캐릭터 모두 공개 배포에 라이선스 제약 없음"},
        "pipeline": {
            "name": "martialdex-keyframe",
            "version": "4 (Phase 7)",
            "steps": ["technique states(key) (grapple_kit 상태)", "author_duo.py: 몸 → 다리 → 머리 → 팔 순서로 IK", "회전 키 + 골반 위치 → 애니메이션 전용 GLB" + (" (A_/B_ 접두사, 한 타임라인)" if duo else "")],
            "report": "data/audit/motion3d-phase7.json",
        },
        "quality": {"status": "review", "verified": False, "knownIssues": issues},
    }
    if duo:
        log_keys = log["keys"]
        arm = min(k["chokeArmToNeckM"] for k in log_keys)
        hand = min(k["backHandToHeadM"] for k in log_keys)
        e["source"]["safety"] = f"안전 시범: 조르는 팔(상완·전완 뼈)과 B의 목·머리 뼈 사이 거리 ≥ {arm:.3f} m를 모든 키에서 측정·유지, 조이는 움직임 없음, 뒤 손은 머리에 닿지 않음(≥ {hand:.3f} m), B의 머리·목 자세(시선·숙임)는 모든 키에서 같음, B는 저항·강제 움직임 없음"
        e["source"]["replaces"] = "bjj-rear-naked-choke-m2m-v2 — 파일 유지, retiredClips"
    return e


def main():
    cat = json.load(open(CAT))
    new = {c[0]: entry(*c) for c in CLIPS}
    # RNC v2 -> retiredClips (its GLB stays on disk)
    keep = []
    for c in cat["clips"]:
        if c["clipId"] == "bjj-rear-naked-choke-m2m-v2":
            c = dict(c)
            c["retired"] = {"at": TODAY, "reason": "Phase 7 재제작: 손을 맞잡는 변형이라 리어 네이키드 초크의 형태(턱 아래 팔꿈치·이두 잡기·머리 뒤 손)가 보이지 않고, 맞잡은 손이 B의 귀 옆에 떠 있음; 팔끼리 겹침 최대 616 삼각형 쌍 — 파일 보존", "replacedBy": "bjj-rear-naked-choke-m2m-v3"}
            cat["retiredClips"] = [r for r in cat["retiredClips"] if r["clipId"] != c["clipId"]] + [c]
            continue
        if c["clipId"] in new:
            continue
        keep.append(c)
    cat["clips"] = keep + [new[c[0]] for c in CLIPS]
    with open(CAT, "w") as f:
        json.dump(cat, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("clips", len(cat["clips"]), "retired", len(cat["retiredClips"]))


if __name__ == "__main__":
    main()
