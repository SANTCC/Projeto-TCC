// Edge Function: relatório operacional de carga em PDF (Backlog 3, item B).
// Implantação: supabase functions deploy relatorio-pdf (verify_jwt = false em supabase/config.toml).
// A lógica está em handler.js e relatorio.js/pdf.js, testada em Node (tests/test_relatorio_pdf.js).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { criarHandler } from './handler.js';

Deno.serve(criarHandler({
  criarCliente: createClient,
  lib: { PDFDocument, StandardFonts, rgb },
  env: (nome: string) => Deno.env.get(nome) ?? ''
}));
