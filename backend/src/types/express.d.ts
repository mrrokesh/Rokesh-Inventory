declare global {
  namespace Express {
    interface Request {
      user?: any;
      orgId?: any;
      viaApiKey?: boolean;
      contact?: any;
      org?: any;
      platformAdmin?: any;
    }
  }
}

export {};
