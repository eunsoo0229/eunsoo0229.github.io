# Sibling-art relation judgement — criteria (read fully)

Each item is a MARTIALDEX technique that is currently filed under ONE art only (`art`). `candidates` are sibling arts it is not linked to and that were never judged for it
(striking: boxing / kickboxing / muay-thai / karate / taekwondo; grappling: bjj / judo / wrestling / sambo; an MMA-only technique is checked against all nine).
For EVERY candidate art, decide whether this technique really is a technique practiced/used in that art.

Evidence you may use (cite it in `evidence`):
- the art's own MARTIALDEX catalog: data/audit/sibling-packs/catalog-<art>.tsv (id, name, [category]) — what the art already contains;
- your knowledge of the art's standard curriculum / competition rules (cite the rule or the art's name for the technique, e.g. judo "Kata-guruma", sambo "Мельница");
- WebSearch when you are unsure (cite the URL). Do not invent sources.

Decision per (technique, candidate art):
- "add" — it is a standard, genuinely used technique of the target art (taught in its curriculum and/or used in its competition), done essentially the same way. confidence "A" = it is a core/named technique of that art (e.g. kickboxing roundhouse ↔ Muay Thai round kick; wrestling double leg ↔ sambo/BJJ takedown), "B" = clearly used but less central.
- "none" — not that art's technique. Typical: illegal or absent under the target art's rules and curriculum (e.g. elbows, knees or kicks in boxing; leg locks in judo; chokes in sport sambo; gi grips in wrestling) — but a restriction at some levels only is NOT a reason (BJJ still uses heel hooks); a rule/scoring/competition-format concept of the source art (folkstyle riding time, tilts for back points, point-karate rules, poomsae/kata/tul, breaking, belt tests); a heading or a non-technique; a stance/footwork so specific to the source art that it does not transfer; a self-defense drill only.
- "none" ALSO when the target art already has the same technique under another name in its catalog — put that catalog id in `duplicateOf` (e.g. judo "Hadaka-jime" when the item is a BJJ "Rear Naked Choke"). Do not link a second copy.
- "review" — unsure (rare, flashy, variants whose identity differs, borderline legality). Never guess "add".

Rules: same English word ≠ same technique (a wrestling "Switch" is not a kickboxing stance switch; a BJJ "Base" is not a karate stance). Lead/rear/side/target variants are separate techniques — judge the item exactly as described. Never add because "it is common in combat sports" or "MMA uses everything". Be conservative: a wrong link puts a foreign technique into an art's list.

`category` (only for "add"): copy one category name exactly as it appears in the target art's catalog brackets `[...]` — the one where that art files similar techniques.

Output: ONE JSON file (path given) = array, one object per (item, candidate art) pair, items in input order, candidates in their listed order, no omissions:
{"id": "<technique id>", "art": "<candidate art>", "decision": "add"|"none"|"review", "confidence": "A"|"B"|"C", "category": "<target art category or null>", "duplicateOf": "<catalog id or null>", "reason": "<one short Korean sentence>", "evidence": "<rule / art's own name for it / catalog line / URL>"}
confidence for "none": "A" when a clear disqualifier applies (rules, kata, heading, duplicate), else "B". "review" uses "C".
Then reply with counts per decision only.
