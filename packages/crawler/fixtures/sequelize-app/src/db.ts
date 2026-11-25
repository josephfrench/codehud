import { Sequelize, DataTypes } from 'sequelize';
export const sequelize = new Sequelize({ dialect: 'postgres' });
export const Customer = sequelize.define('customers', { id: { type: DataTypes.UUID, primaryKey: true }, email: DataTypes.STRING, plan: DataTypes.STRING });
