-- Migration 023: Employee business assignments for maintainer scoping
CREATE TABLE IF NOT EXISTS employee_businesses (
  id          CHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
  employee_id CHAR(36)  NOT NULL,
  business_id CHAR(36)  NOT NULL,
  assigned_by CHAR(36)  NULL,
  assigned_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_biz (employee_id, business_id),
  CONSTRAINT fk_eb_emp  FOREIGN KEY (employee_id) REFERENCES users(id)       ON DELETE CASCADE,
  CONSTRAINT fk_eb_biz  FOREIGN KEY (business_id) REFERENCES businesses(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 023 OK — employee_businesses table created' AS status;
