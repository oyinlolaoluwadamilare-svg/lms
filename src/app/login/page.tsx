import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in | Workforce Group CPMS' };

export default function LoginPage() {
  return (
    <main className="flex-1 bg-navy flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <p className="text-sky text-sm font-bold tracking-[0.2em] uppercase">
              Workforce Group
            </p>
            <h1 className="text-white text-2xl font-bold mt-2">
              Corporate Performance Management
            </h1>
            <p className="text-white/70 text-sm mt-2">
              One live picture of group performance against plan.
            </p>
          </div>
          <LoginForm />
        </div>
      </div>
      <footer className="text-center text-white/50 text-xs pb-6">
        Workforce Group. Lagos, Nigeria.
      </footer>
    </main>
  );
}
