// userDTO.ts
export interface UserDTO {
  first_name: string;
  phone_number: string;
  role: string; // 'mentor' or 'mentee'
  email?: string;
  password?: string;
  last_name?: string;
}