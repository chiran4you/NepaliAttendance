export type TenantConfig = {
  tenantId: string;
  schoolName: string;
  schoolAddress?: string;
  features: {
    csvExportEnabled: boolean;
    smsAlertsEnabled: boolean;
  };
};
