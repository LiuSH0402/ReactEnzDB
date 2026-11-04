type ListColumnOption = {
  id: string;
  label: string;
  group?: "Identity" | "Relationships" | "Evidence" | "Sequence & annotation" | "Structure" | "Standardization";
  defaultVisible?: boolean;
};

export const reactionListColumns: ListColumnOption[] = [
  { id: "reactenz_id", label: "ReactEnzDB ID", group: "Identity" },
  { id: "internal_id", label: "Internal reaction ID", group: "Identity", defaultVisible: false },
  { id: "equation", label: "Equation", group: "Identity" },
  { id: "direction", label: "Direction", group: "Identity" },
  { id: "ec", label: "EC", group: "Identity", defaultVisible: false },
  { id: "rhea", label: "Rhea", group: "Identity", defaultVisible: false },
  { id: "kegg", label: "KEGG", group: "Identity", defaultVisible: false },
  { id: "metacyc", label: "MetaCyc", group: "Identity", defaultVisible: false },
  { id: "mnxref", label: "MNXref", group: "Identity", defaultVisible: false },
  { id: "dataset", label: "Dataset level", group: "Identity", defaultVisible: false },
  { id: "participants", label: "Participants", group: "Relationships", defaultVisible: false },
  { id: "enzymes", label: "Enzymes", group: "Relationships" },
  { id: "pairs", label: "Associations", group: "Relationships", defaultVisible: false },
  { id: "kinetics", label: "Kinetics", group: "Evidence" },
  { id: "evidence_score", label: "Annotation richness", group: "Evidence" },
  { id: "evidence_tier", label: "Evidence tier", group: "Evidence", defaultVisible: false },
  { id: "smiles", label: "SMILES coverage", group: "Structure", defaultVisible: false },
  { id: "structure", label: "Compound structure", group: "Structure", defaultVisible: false },
  { id: "enzyme_structure", label: "Enzyme structure", group: "Structure", defaultVisible: false },
  { id: "pdb", label: "PDB enzymes", group: "Structure", defaultVisible: false },
  { id: "alphafold", label: "AlphaFold enzymes", group: "Structure", defaultVisible: false },
  { id: "standardization", label: "Reaction standardization", group: "Standardization", defaultVisible: false },
];

export const enzymeListColumns: ListColumnOption[] = [
  { id: "reactenz_id", label: "ReactEnzDB ID", group: "Identity" },
  { id: "biopart_id", label: "Biopart ID", group: "Identity", defaultVisible: false },
  { id: "protein_id", label: "Protein ID", group: "Identity", defaultVisible: false },
  { id: "enzyme", label: "Enzyme", group: "Identity" },
  { id: "uniprot", label: "UniProt", group: "Identity" },
  { id: "gene", label: "Gene", group: "Identity", defaultVisible: false },
  { id: "organism", label: "Source organism", group: "Relationships" },
  { id: "taxonomy", label: "Taxonomy", group: "Relationships", defaultVisible: false },
  { id: "reactions", label: "Reactions", group: "Relationships" },
  { id: "chassis", label: "Chassis annotations", group: "Relationships", defaultVisible: false },
  { id: "sequence_status", label: "Sequence status", group: "Sequence & annotation", defaultVisible: false },
  { id: "sequence", label: "Sequence length", group: "Sequence & annotation", defaultVisible: false },
  { id: "interpro", label: "InterPro", group: "Sequence & annotation", defaultVisible: false },
  { id: "pfam", label: "Pfam", group: "Sequence & annotation", defaultVisible: false },
  { id: "protein_sites", label: "Functional sites", group: "Sequence & annotation", defaultVisible: false },
  { id: "structure", label: "Structure", group: "Structure" },
  { id: "pdb", label: "PDB", group: "Structure", defaultVisible: false },
  { id: "alphafold", label: "AlphaFold", group: "Structure", defaultVisible: false },
  { id: "structure_confidence", label: "Structure score", group: "Structure", defaultVisible: false },
  { id: "high_confidence_structure", label: "High-confidence structure", group: "Structure", defaultVisible: false },
  { id: "catalytic_site_support", label: "Catalytic-site support", group: "Structure", defaultVisible: false },
  { id: "kinetics", label: "Kinetics", group: "Evidence" },
  { id: "evidence_score", label: "Annotation richness", group: "Evidence" },
  { id: "evidence_tier", label: "Evidence tier", group: "Evidence", defaultVisible: false },
  { id: "evidence", label: "Evidence label", group: "Evidence", defaultVisible: false },
];
