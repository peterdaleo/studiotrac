CREATE TABLE project_sub_budgets (
  id int NOT NULL AUTO_INCREMENT,
  organizationId int NULL,
  projectId int NOT NULL,
  name varchar(255) NOT NULL,
  phase enum('pre_design','schematic_design','design_development','construction_documents','bidding_negotiation','construction_administration','post_occupancy') NULL,
  description text NULL,
  budgetCents int NOT NULL,
  kind enum('within_existing','approved_addition') NOT NULL,
  status enum('proposed','approved','complete') NOT NULL DEFAULT 'proposed',
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_sub_budgets_project (projectId),
  KEY idx_project_sub_budgets_org_project (organizationId, projectId),
  KEY idx_project_sub_budgets_status_kind (projectId, kind, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE time_entries ADD COLUMN subBudgetId int NULL;
ALTER TABLE consultant_contracts ADD COLUMN subBudgetId int NULL;
CREATE INDEX idx_time_entries_sub_budget ON time_entries (subBudgetId);
CREATE INDEX idx_consultant_contracts_sub_budget ON consultant_contracts (subBudgetId);
