# Traxis Correlation Run (GitHub Ready)

This folder contains the finalized outputs from the VM execution plan, prepared for a single GitHub push.

## Included

- `traxis-correlation-production-20260417T071458Z.tar.zst`  
  Full production package artifact.
- `manifest-20260417T071458Z.txt`  
  Manifest + file hashes generated on VM during packaging.
- `final_audit_step18.json`  
  End-to-end pass/fail audit across required artifacts and criteria.
- `detailed_audit_report.json` / `detailed_audit_report.md`  
  Deep verification report with recomputed evidence and SHA256 values.
- `final_summary_step19.json` / `final_summary_step19.md`  
  Final execution summary.
- `model_metrics_step12.json`  
  LightGBM model performance report.
- `walkforward_step16_metrics.json`  
  Walk-forward backtest significance report.
- `optimization_metrics_step13.json`  
  Portfolio optimization quality report.
- `monte_carlo_step14.json`  
  Monte Carlo VaR/CVaR report.
- `local_recheck_report.json`  
  Local post-download consistency verification.

## Key Outcomes

- Classifier precision: `0.9432` (target >= `0.80`)
- Walk-forward improvement: positive and significant (`p = 3.10e-05`)
- Risk outputs consistent (`VaR_99 >= VaR_95`, `CVaR_99 >= CVaR_95`)
- Final audits: pass

## Push Notes

- This folder is intentionally minimal and report-focused.
- If you also want reproducibility scripts, include the `vm-step*.sh` scripts from `C:\Users\tharu`.
