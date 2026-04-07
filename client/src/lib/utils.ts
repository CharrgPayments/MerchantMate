import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  const limited = digits.slice(0, 10);
  if (limited.length <= 3) {
    return limited;
  } else if (limited.length <= 6) {
    return `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
  } else {
    return `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
  }
}

export function unformatPhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatEIN(value: string): string {
  const digits = value.replace(/\D/g, '');
  const limited = digits.slice(0, 9);
  if (limited.length <= 2) {
    return limited;
  } else {
    return `${limited.slice(0, 2)}-${limited.slice(2)}`;
  }
}

export function unformatEIN(value: string): string {
  return value.replace(/\D/g, '');
}

function getSecureRandomInt(max: number): number {
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  return randomBuffer[0] % max;
}

export function generatePassword(): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%^&*-_+=';

  const password = [
    uppercase[getSecureRandomInt(uppercase.length)],
    uppercase[getSecureRandomInt(uppercase.length)],
    lowercase[getSecureRandomInt(lowercase.length)],
    lowercase[getSecureRandomInt(lowercase.length)],
    numbers[getSecureRandomInt(numbers.length)],
    numbers[getSecureRandomInt(numbers.length)],
    special[getSecureRandomInt(special.length)],
    special[getSecureRandomInt(special.length)],
  ];

  const allChars = uppercase + lowercase + numbers + special;
  for (let i = password.length; i < 16; i++) {
    password.push(allChars[getSecureRandomInt(allChars.length)]);
  }

  for (let i = password.length - 1; i > 0; i--) {
    const j = getSecureRandomInt(i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join('');
}
