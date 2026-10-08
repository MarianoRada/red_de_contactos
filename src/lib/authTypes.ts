export type AuthUser = {
  id: string;
  email: string;
  role: 'admin';
};

export type AuthSession = {
  authenticated: boolean;
  user?: AuthUser;
  csrfToken: string;
};
