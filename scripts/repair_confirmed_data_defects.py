"""Original kinetic score refresh helper; one-off repair records are excluded."""
import collections, sqlite3
from build_evidence_scores import tier

def refresh_kinetic_scores(c: sqlite3.Connection, expected: dict) -> int:
    """Change only the existing capped kinetic-PMID contribution (4 points/PMID)."""
    old={(r[0],r[1]):r for r in c.execute("SELECT * FROM web_evidence_scores NOT INDEXED")}
    old_scores={key:row[2] for key,row in old.items()}
    new_scores=old_scores.copy()
    changed=0
    for (kind,entity),row in old.items():
        if kind not in {"enzyme","reaction"}:continue
        n=len(expected[kind,entity])
        if n<row[7]:raise RuntimeError(f"Unexpected loss of kinetic PMIDs: {kind}/{entity}")
        score=min(100,row[2]+4*(min(n,4)-min(row[7],4)))
        new_scores[kind,entity]=score
        if n!=row[7] or score!=row[2]:
            c.execute("UPDATE web_evidence_scores SET kinetic_pmids=?,evidence_score=?,evidence_tier=? WHERE entity_type=? AND entity_id=?",(n,score,tier(score),kind,entity))
            changed+=1
    # Update only the delta induced in the existing organism/chassis formula.
    for kind,query in [("organism","SELECT organism,reaction_id,biopart_id FROM web_reaction_enzymes WHERE organism IS NOT NULL AND trim(organism)<>''"),
        ("chassis","SELECT chassis_label,reaction_id,biopart_id FROM web_chassis_records WHERE chassis_label IS NOT NULL AND trim(chassis_label)<>''")]:
        groups=collections.defaultdict(list)
        for label,rid,bid in c.execute(query):groups[label].append((rid,bid))
        for label,links in groups.items():
            rids={r for r,b in links};bids={b for r,b in links}
            structure=any(old.get(("enzyme",b),(None,)*12)[10] for b in bids)
            def group_score(scores):
                avg_r=sum(scores.get(("reaction",r),0) for r in rids)/max(1,len(rids))
                avg_b=sum(scores.get(("enzyme",b),0) for b in bids)/max(1,len(bids))
                return min(100,round(avg_b*.45+avg_r*.25+min(len(links),200)*.03+min(len(bids),100)*.08+min(len(rids),100)*.08+(6 if structure else 0)))
            prior=old[kind,label]
            score=min(100,prior[2]+group_score(new_scores)-group_score(old_scores))
            if score!=prior[2]:c.execute("UPDATE web_evidence_scores SET evidence_score=?,evidence_tier=? WHERE entity_type=? AND entity_id=?",(score,tier(score),kind,label))
    return changed
