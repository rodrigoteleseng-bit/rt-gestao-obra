-- Número da NF do lançamento financeiro, usado na aba "RF MM-YY" da
-- exportação Excel (coluna "Nº NF") e na conferência de despesas.
-- Nullable, sem invenção de dado quando vazio.
ALTER TABLE lancamentos_financeiros ADD COLUMN nf_numero TEXT;
