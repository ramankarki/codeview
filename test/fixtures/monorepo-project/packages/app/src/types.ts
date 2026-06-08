export interface User {
  id: string;
  email: string;
  name: string;
}

export interface CreateUserParams {
  email: string;
  name?: string;
}
