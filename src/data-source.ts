import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from './database/data-source-options';

export default new DataSource(createDataSourceOptions());
