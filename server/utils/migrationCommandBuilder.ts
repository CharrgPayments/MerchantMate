/**
 * Migration Command Builder - Generates bulletproof migration commands for schema differences
 * 
 * This utility extracts the command generation logic from migration-manager.ts
 * to be used by both CLI and API for displaying actionable migration commands.
 */

export interface SchemaDifference {
  table: string;
  column?: string;
  type: 'missing_in_target' | 'extra_in_target' | 'type_mismatch' | 'missing_table' | 'extra_table';
  details?: any;
}

export interface MigrationCommand {
  command: string;
  description: string;
  environment?: string;
  riskLevel: 'low' | 'medium' | 'high';
  category: 'generate' | 'apply' | 'validate' | 'backup';
}

export class MigrationCommandBuilder {
  private static readonly BASE_COMMAND = 'tsx scripts/migration-manager.ts';

  /**
   * Generate migration commands for a specific schema difference
   */
  static generateCommandsForDifference(diff: SchemaDifference): MigrationCommand[] {
    const commands: MigrationCommand[] = [];

    switch (diff.type) {
      case 'missing_in_target':
      case 'extra_in_target':
      case 'type_mismatch':
        commands.push(...this.generateColumnDifferenceCommands(diff));
        break;
      
      case 'missing_table':
      case 'extra_table':
        commands.push(...this.generateTableDifferenceCommands(diff));
        break;
    }

    return commands;
  }

  /**
   * Generate commands for column-level differences
   */
  private static generateColumnDifferenceCommands(diff: SchemaDifference): MigrationCommand[] {
    const commands: MigrationCommand[] = [];

    // Step 1: Generate migration
    commands.push({
      command: `${this.BASE_COMMAND} generate`,
      description: `Generate migration to ${this.getDifferenceAction(diff)} column '${diff.column}' in table '${diff.table}'`,
      riskLevel: 'low',
      category: 'generate'
    });

    // Step 2: Apply to test first (safest workflow)
    commands.push({
      command: `${this.BASE_COMMAND} apply test`,
      description: `Apply migration to test environment for validation`,
      environment: 'test',
      riskLevel: 'low',
      category: 'apply'
    });

    // Step 3: Validate
    commands.push({
      command: `${this.BASE_COMMAND} validate`,
      description: `Validate schema consistency across environments`,
      riskLevel: 'low',
      category: 'validate'
    });

    // Step 4: Apply to production (after testing)
    commands.push({
      command: `${this.BASE_COMMAND} apply production`,
      description: `Apply migration to production (after testing and validation)`,
      environment: 'production',
      riskLevel: this.getProductionRiskLevel(diff),
      category: 'apply'
    });

    return commands;
  }

  /**
   * Generate commands for table-level differences
   */
  private static generateTableDifferenceCommands(diff: SchemaDifference): MigrationCommand[] {
    const commands: MigrationCommand[] = [];

    // Table changes are higher risk
    commands.push({
      command: `${this.BASE_COMMAND} generate`,
      description: `Generate migration to ${this.getDifferenceAction(diff)} table '${diff.table}'`,
      riskLevel: 'medium',
      category: 'generate'
    });

    // Always create backup for table changes
    commands.push({
      command: `${this.BASE_COMMAND} backup production`,
      description: `Create backup before applying table changes`,
      environment: 'production',
      riskLevel: 'low',
      category: 'backup'
    });

    commands.push({
      command: `${this.BASE_COMMAND} apply test`,
      description: `Apply migration to test environment first`,
      environment: 'test',
      riskLevel: 'medium',
      category: 'apply'
    });

    commands.push({
      command: `${this.BASE_COMMAND} validate`,
      description: `Validate schema consistency`,
      riskLevel: 'low',
      category: 'validate'
    });

    commands.push({
      command: `${this.BASE_COMMAND} apply production`,
      description: `Apply migration to production (after thorough testing)`,
      environment: 'production',
      riskLevel: 'high',
      category: 'apply'
    });

    return commands;
  }

  /**
   * Get human-readable action description for difference type
   */
  private static getDifferenceAction(diff: SchemaDifference): string {
    switch (diff.type) {
      case 'missing_in_target':
        return diff.column ? 'add' : 'add missing';
      case 'extra_in_target':
        return diff.column ? 'remove' : 'remove extra';
      case 'type_mismatch':
        return 'fix type mismatch for';
      case 'missing_table':
        return 'add missing';
      case 'extra_table':
        return 'remove extra';
      default:
        return 'synchronize';
    }
  }

  /**
   * Determine risk level for production operations based on difference type
   */
  private static getProductionRiskLevel(diff: SchemaDifference): 'low' | 'medium' | 'high' {
    if (diff.type === 'extra_in_target') {
      // Removing columns/tables is high risk
      return 'high';
    } else if (diff.type === 'type_mismatch') {
      // Type changes can be risky
      return 'medium';
    } else {
      // Adding columns/tables is generally safe
      return 'low';
    }
  }

  /**
   * Generate a complete workflow for multiple differences
   */
  static generateWorkflowCommands(differences: SchemaDifference[]): MigrationCommand[] {
    if (differences.length === 0) {
      return [];
    }

    // For multiple differences, generate a consolidated workflow
    const hasHighRisk = differences.some(diff => 
      diff.type === 'extra_in_target' || 
      diff.type === 'missing_table' || 
      diff.type === 'extra_table'
    );

    const commands: MigrationCommand[] = [];

    // Step 1: Generate migration for all changes
    commands.push({
      command: `${this.BASE_COMMAND} generate`,
      description: `Generate migration to resolve ${differences.length} schema difference(s)`,
      riskLevel: hasHighRisk ? 'medium' : 'low',
      category: 'generate'
    });

    // Step 2: Create backup if high risk
    if (hasHighRisk) {
      commands.push({
        command: `${this.BASE_COMMAND} backup production`,
        description: `Create backup before applying high-risk changes`,
        environment: 'production',
        riskLevel: 'low',
        category: 'backup'
      });
    }

    // Step 3: Apply to test
    commands.push({
      command: `${this.BASE_COMMAND} apply test`,
      description: `Apply migration to test environment`,
      environment: 'test',
      riskLevel: 'low',
      category: 'apply'
    });

    // Step 4: Validate
    commands.push({
      command: `${this.BASE_COMMAND} validate`,
      description: `Validate schema consistency across environments`,
      riskLevel: 'low',
      category: 'validate'
    });

    // Step 5: Apply to production
    commands.push({
      command: `${this.BASE_COMMAND} apply production`,
      description: `Apply migration to production`,
      environment: 'production',
      riskLevel: hasHighRisk ? 'high' : 'medium',
      category: 'apply'
    });

    return commands;
  }

  /**
   * Get status check command
   */
  static getStatusCommand(): MigrationCommand {
    return {
      command: `${this.BASE_COMMAND} status`,
      description: 'Check migration status across all environments',
      riskLevel: 'low',
      category: 'validate'
    };
  }

  /**
   * Get validation command
   */
  static getValidationCommand(): MigrationCommand {
    return {
      command: `${this.BASE_COMMAND} validate`,
      description: 'Validate schema consistency across environments',
      riskLevel: 'low',
      category: 'validate'
    };
  }
}