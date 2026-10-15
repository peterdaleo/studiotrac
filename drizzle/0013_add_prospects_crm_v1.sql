-- StudioTrac Prospects CRM v1. No financial fields are stored here.
-- Also created idempotently during application startup so deployment does not
-- require a separate manual migration step.
CREATE TABLE IF NOT EXISTS prospects (
  id int NOT NULL AUTO_INCREMENT,
  organizationId int NULL,
  firm varchar(255) NOT NULL,
  opportunityName varchar(500) NOT NULL,
  contact varchar(500) NULL,
  referralSource varchar(255) NULL,
  stage enum('New','Contacted','Proposal','Negotiation','Won','Lost') NOT NULL DEFAULT 'New',
  ownerId int NULL,
  nextFollowUpDate date NULL,
  convertedProjectId int NULL,
  convertedAt timestamp NULL,
  createdById int NULL,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prospects_org_stage (organizationId, stage),
  KEY idx_prospects_followup (organizationId, nextFollowUpDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_interactions (
  id int NOT NULL AUTO_INCREMENT,
  organizationId int NULL,
  prospectId int NOT NULL,
  type enum('note','call','email','meeting','proposal') NOT NULL DEFAULT 'note',
  content text NOT NULL,
  happenedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  isPrivate tinyint(1) NOT NULL DEFAULT 0,
  createdById int NULL,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prospect_interactions_timeline (prospectId, happenedAt),
  KEY idx_prospect_interactions_org (organizationId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
