"""Phase 7 audit summary -> data/audit/motion3d-phase7.json (read only over the catalog, the authoring logs and the
mesh reviews; run after phase7_catalog.py).

    python3 scripts/motion3d/phase7_report.py
"""
import json
import os

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

SELECTION = {
    "boxing-rear-uppercut-m2m-v1": ("복싱", "기본 4펀치 중 3D 클립이 없던 마지막 펀치 — 아래에서 위로 올리는 궤적과 다리·골반 회전은 영상 한 각도로 보기 어려움"),
    "boxing-slip-m2m-v1": ("복싱", "기본 방어. 머리 위치가 중심선에서 어떻게 빠지는지(허리가 아니라 어깨 회전·무릎) 360°로 확인하는 교육 효과가 큼"),
    "kickboxing-body-kick-m2m-v1": ("킥복싱", "가장 기본적인 라운드킥 — 앞발 피벗과 골반 회전, 정강이 타격면을 여러 각도에서 확인"),
    "kickboxing-straight-knee-m2m-v1": ("킥복싱 (무에타이 카오 트롱과 같은 기술로 병합)", "니 공격의 기본 — 무릎만 드는 것이 아니라 골반을 앞으로 미는 동작"),
    "kickboxing-horizontal-elbow-m2m-v1": ("킥복싱 (무에타이 속 탓과 병합)", "엘보 계열 첫 클립 — 근거리에서 팔꿈치가 수평으로 지나가는 궤적"),
    "muaythai-push-teep-m2m-v1": ("무에타이", "무에타이의 대표 거리 조절 기술 — 무릎 들기 후 골반으로 미는 동작(스냅 킥과 구분)"),
    "mma-overhand-m2m-v1": ("MMA", "MMA 대표 펀치 — 머리를 중심선 밖으로 빼며 위에서 내려치는 궤적"),
    "wrestling-sprawl-m2m-v1": ("레슬링", "테이크다운 방어의 기본 — 기존 더블렉(공격) 클립과 짝을 이루는 방어 동작"),
    "bjj-hip-escape-m2m-v1": ("브라질리언 주짓수 (유도 새우빼기와 병합)", "하위 포지션 탈출의 기본 움직임 — 옆으로 누워 골반을 빼는 C자 모양"),
    "bjj-technical-stand-up-m2m-v1": ("브라질리언 주짓수", "바닥에서 안전하게 일어서는 포지션 전환 — 손·발 지지와 다리를 몸 아래로 빼는 경로"),
}


def main():
    cat = json.load(open(os.path.join(APP, "data/curated/motion3d.json")))
    clips = [c for c in cat["clips"] if c["pipeline"]["version"] == "4 (Phase 7)"]
    out = {"generatedBy": "scripts/motion3d/phase7_report.py (Phase 7: RNC 재제작 + 신규 10종)", "clips": {}}
    for c in clips:
        art_dir = c["source"]["blendSource"].split("/")[3]
        log = json.load(open(os.path.join(APP, f"assets/3d/motion-library/{art_dir}/{c['clipId']}.json")))
        e = {
            "techniqueIds": c["techniqueIds"],
            "title": c["title"],
            "file": "public/" + c["file"],
            "durationSec": c["durationSec"],
            "frames": c["frameCount"],
            "phases": [f"{p['label']} {p['startSec']:.2f}–{p['endSec']:.2f}s" for p in c["phases"]],
            "review": c["source"]["review"].split(" ")[0],
            "reviewImage": c["source"]["reviewImage"],
            "reviewStats": c["source"]["reviewStats"],
            "knownIssues": c["quality"]["knownIssues"],
        }
        if c["clipId"] in SELECTION:
            e["art"], e["selectionReason"] = SELECTION[c["clipId"]]
        if "chokeArmToNeckM" in log["keys"][0]:
            hold = [k for k in log["keys"] if 72 <= k["key"] <= 102]
            e["safety"] = {
                "chokeArmToNeckMinM": min(k["chokeArmToNeckM"] for k in log["keys"]),
                "backHandToHeadMinM": min(k["backHandToHeadM"] for k in log["keys"]),
                "holdGripGapMaxM": max(k["gripGapM"] for k in hold),
                "holdHeadToHeadMinM": min(k["headToHeadM"] for k in hold),
            }
        out["clips"][c["clipId"]] = e
    with open(os.path.join(APP, "data/audit/motion3d-phase7.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("clips", len(out["clips"]))


if __name__ == "__main__":
    main()
