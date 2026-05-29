# Detailed Audit Report

- Verdict: **PASS**
- Scope: steps 1-19 artifact integrity + recomputed metric checks

## Check Results
- classifier_precision_ge_0_80: PASS
- walkforward_significant: PASS
- walkforward_recomputed_p_lt_0_05: PASS
- walkforward_positive_improvement: PASS
- risk_monotonic_var: PASS
- risk_monotonic_cvar: PASS

## Recomputed Evidence
- Recomputed walk-forward p-value: 3.0981177e-05
- Recomputed walk-forward t-stat: 12.337186

## Headline Metrics
- classifier_precision: 0.9432484665154188
- classifier_recall: 0.8830572206227089
- classifier_roc_auc: 0.9326110535406582
- walkforward_mean_improvement: 0.04821899362232748
- walkforward_p_value: 3.098117675952937e-05
- VaR_95: 0.02430657748883393
- VaR_99: 0.03396261664229757
- CVaR_95: 0.0303083680621449
- CVaR_99: 0.039027140655037755

## Data Row Counts
- unified_rows: 359920000
- timeseries_rows: 955997
- timeseries_filtered_rows: 223095
- embedding_rows: 408863
- cluster_rows: 408863
- entity_rows: 780256
- correlation_rows: 411146
- feature_rows: 411146

## Artifact SHA256
- package: `3d628e04be21abbe745c764d5baff7c2bf86a087f5e2cb2830acd13ddda62327`
- final_audit: `7fc6b078fdc79d72ce8205e0ec0e7230e43a4da5320a6146852830f69e876a7c`
- final_summary_json: `570519fcb6dae0a475709947b475df4b45e02423657bf6dab8c5d34ef9a3c503`
- final_summary_md: `8fe42857c47e00570bb7852b314535138c8d0640d8da7311facc0cc72ecf4c80`
- model_metrics: `cbd546dcd8a195a9a188878ec129ada39539381740be27e7cc582b74fdacf9f1`
- walkforward_metrics: `005a0dd617e2349c6adc731d0a3824a347947494182a3f1236dcb005f4dce188`
- risk_metrics: `4e1d1d22d3b72c1fe735de8850e05be6932b22834e39965540e76d2b627b2b7e`
