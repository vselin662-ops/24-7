import { BaseConnector, ConnectorResponse } from "./base";
import { TaxiConnector } from "./taxi.connector";
import { FoodDeliveryConnector } from "./food.connector";
import { TravelConnector } from "./travel.connector";
import { InstagramConnector } from "./instagram.connector";
import { BusinessPlanConnector } from "./business-plan.connector";

export * from "./base";
export * from "./taxi.connector";
export * from "./food.connector";
export * from "./travel.connector";
export * from "./instagram.connector";
export * from "./business-plan.connector";

export class ConnectorRegistry {
  private connectors = new Map<string, BaseConnector>();

  constructor() {
    this.register(new TaxiConnector());
    this.register(new FoodDeliveryConnector());
    this.register(new TravelConnector());
    this.register(new InstagramConnector());
    this.register(new BusinessPlanConnector());
  }

  public register(connector: BaseConnector): void {
    this.connectors.set(connector.name, connector);
  }

  public get(name: string): BaseConnector | undefined {
    return this.connectors.get(name);
  }

  public getAll(): BaseConnector[] {
    return Array.from(this.connectors.values());
  }

  public async execute<T = any>(name: string, params: any, tenantId?: string): Promise<ConnectorResponse<T>> {
    const connector = this.get(name);
    if (!connector) {
      throw new Error(`Интеграционный коннектор '${name}' не зарегистрирован в системе`);
    }
    return await connector.run(params, tenantId);
  }
}

export const connectorRegistry = new ConnectorRegistry();
