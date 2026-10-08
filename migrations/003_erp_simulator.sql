CREATE SCHEMA erp_sim;
CREATE TABLE erp_sim.initialization (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton)
);
CREATE TABLE erp_sim."AP_VND" (
    "CO_CD" text NOT NULL, "VND_NO" text NOT NULL, "NM" text NOT NULL,
    PRIMARY KEY ("CO_CD", "VND_NO")
);
CREATE TABLE erp_sim."AP_INV" (
    "CO_CD" text NOT NULL, "VND_NO" text NOT NULL, "INV_NO" text NOT NULL,
    "JB_NO" text NOT NULL, "GROSS_AMT" numeric(18,2) NOT NULL CHECK ("GROSS_AMT">=0),
    "CCY" text NOT NULL, "INV_DT" date NOT NULL,
    "ST_CD" text NOT NULL CHECK ("ST_CD" IN ('O','P','V')),
    PRIMARY KEY ("CO_CD", "VND_NO", "INV_NO"),
    FOREIGN KEY ("CO_CD", "VND_NO") REFERENCES erp_sim."AP_VND"("CO_CD", "VND_NO")
);
